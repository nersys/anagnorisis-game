"""
AI Dungeon Master - Powered by Claude

============================================
DDIA CONCEPT: External Service Integration
============================================
Integrating with external APIs requires:

1. Reliability: What if the API is down?
2. Latency: Network calls are slow; how do we handle?
3. Cost: API calls cost money; how do we optimize?
4. Rate Limits: Don't overwhelm the service

For MVP, we keep it simple. In production:
- Add retry logic with exponential backoff
- Cache common responses
- Queue requests during rate limits
- Have fallback responses when API fails
============================================
"""

import logging
import re
from typing import Optional

from anthropic import Anthropic, APIError

from shared.models import Adventure, Player, AdventureMode, Room
from server.dm_prompt import build_system_prompt

# Regex to detect a dice roll request embedded by the DM in its response.
# Format: [[ROLL:d20:STAT:DC]]  e.g. [[ROLL:d20:STR:12]]
DICE_TAG_RE = re.compile(r'\[\[ROLL:(d\d+):([A-Z]+):(\d+)\]\]', re.IGNORECASE)

logger = logging.getLogger("anagnorisis.dm")

MAX_HISTORY_TURNS = 30  # keep last N user+assistant pairs in context


class AIDungeonMaster:
    """
    The AI-powered Dungeon Master using Claude.
    
    Responsibilities:
    - Generate adventure introductions
    - Process and respond to player actions
    - Maintain narrative consistency
    - Apply game rules when appropriate
    """
    
    def __init__(self, api_key: str):
        """Initialize with Anthropic API key."""
        self._client = Anthropic(api_key=api_key)
        self._model = "claude-sonnet-4-20250514"  # Using Sonnet for good balance of speed/quality
        logger.info(f"AI DM initialized with model: {self._model}")
    
    def _build_party_context(self, players: list[Player]) -> str:
        """Build a context string describing the party."""
        if not players:
            return "A lone adventurer."
        
        lines = ["The party consists of:"]
        for p in players:
            lines.append(
                f"- {p.name}, a level {p.stats.level} {p.player_class.value} "
                f"(HP: {p.stats.health}/{p.stats.max_health}, "
                f"Skills: {', '.join(p.skills[:3])})"
            )
        return "\n".join(lines)
    
    async def generate_intro(
        self,
        adventure: Adventure,
        party: list[Player],
        location_name: str = "",
        nearby_places: list[str] | None = None,
    ) -> str:
        """
        Generate the opening narrative for an adventure, tailored to real nearby places.
        """
        party_context = self._build_party_context(party)

        location_lines = ""
        if location_name:
            location_lines += f"\nReal-world setting: {location_name}."
        if nearby_places:
            places_str = ", ".join(nearby_places[:6])
            location_lines += (
                f"\nNearby real locations transformed into dungeon rooms: {places_str}. "
                "Weave these real place names naturally into the narrative with dark fantasy flavor."
            )

        prompt = f"""Begin a new adventure called "{adventure.name}".

Adventure Description: {adventure.description}
{location_lines}

{party_context}

Write an atmospheric opening that:
1. Sets the scene using the real-world location as a dark fantasy setting
2. Introduces a specific quest hook tied to one of the nearby places (if provided)
3. Gives players a vivid sense of immediate danger or intrigue

Keep it to 2-3 paragraphs. Name-drop the real places with fantasy names. Be cinematic and urgent."""

        try:
            response = self._client.messages.create(
                model=self._model,
                max_tokens=1024,
                system=SYSTEM_PROMPTS.get(adventure.mode, SYSTEM_PROMPTS[AdventureMode.GUIDED]),
                messages=[{"role": "user", "content": prompt}]
            )
            
            return response.content[0].text
            
        except APIError as e:
            logger.error(f"API error generating intro: {e}")
            return self._fallback_intro(adventure)
        except Exception as e:
            logger.error(f"Error generating intro: {e}")
            return self._fallback_intro(adventure)
    
    def _fallback_intro(self, adventure: Adventure) -> str:
        """Fallback intro when API fails."""
        return f"""The adventure "{adventure.name}" begins...

{adventure.description}

You stand at the threshold of the unknown, ready to face whatever challenges await. 
The air is thick with anticipation. What do you do?"""
    
    async def process_action(
        self,
        adventure: Adventure,
        acting_player: Player,
        party: list[Player],
        action: str,
    ) -> str:
        """Process a player action, maintain conversation memory, return DM response."""
        party_context = self._build_party_context(party)
        user_msg = (
            f"[Day {adventure.game_day} | {acting_player.name} the {acting_player.player_class.value}]\n"
            f"{action}\n\n"
            f"Party: {party_context}"
        )

        # Use rolling adventure conversation log as memory
        history = list(adventure.conversation_log[-MAX_HISTORY_TURNS:])
        history.append({"role": "user", "content": user_msg})

        system = build_system_prompt(dungeon_name=adventure.name)

        try:
            response = self._client.messages.create(
                model=self._model,
                max_tokens=400,  # Enforce brevity
                system=system,
                messages=history,
            )
            text = response.content[0].text

            # Append both sides to adventure memory
            adventure.conversation_log.append({"role": "user", "content": user_msg})
            adventure.conversation_log.append({"role": "assistant", "content": text})
            # Trim to cap memory
            if len(adventure.conversation_log) > MAX_HISTORY_TURNS * 2:
                adventure.conversation_log = adventure.conversation_log[-(MAX_HISTORY_TURNS * 2):]

            return text

        except APIError as e:
            logger.error(f"API error processing action: {e}")
            return self._fallback_action_response(acting_player, action)
        except Exception as e:
            logger.error(f"Error processing action: {e}")
            return self._fallback_action_response(acting_player, action)
    
    @staticmethod
    def extract_dice_request(text: str) -> Optional[dict]:
        """Parse a [[ROLL:d20:STAT:DC]] tag from DM response. Returns dict or None."""
        m = DICE_TAG_RE.search(text)
        if not m:
            return None
        return {
            "die": m.group(1).lower(),        # e.g. "d20"
            "stat": m.group(2).upper(),        # e.g. "STR"
            "dc": int(m.group(3)),             # e.g. 12
            "raw_tag": m.group(0),
        }

    @staticmethod
    def strip_dice_tag(text: str) -> str:
        """Remove [[ROLL:...]] tag from text."""
        return DICE_TAG_RE.sub('', text).strip()

    async def resolve_with_roll(
        self,
        adventure: Adventure,
        acting_player: Player,
        party: list[Player],
        original_action: str,
        setup_narrative: str,
        roll_total: int,
        dc: int,
        stat: str,
        die: str,
    ) -> str:
        """
        Called after the player rolls. Feeds the roll result back to the DM
        to get the resolution narrative (success or failure).
        """
        success = roll_total >= dc
        outcome = "SUCCESS" if success else "FAILURE"

        prompt = (
            f"The player attempted: \"{original_action}\"\n\n"
            f"You (the DM) had set up this scene:\n{setup_narrative}\n\n"
            f"The player rolled {die} + {stat} modifier = {roll_total} vs DC {dc}.\n"
            f"Result: {outcome}.\n\n"
            f"Now describe the outcome in 1-2 paragraphs. Be dramatic. "
            f"On success, let them achieve their goal with flair. "
            f"On failure, something goes wrong — but keep the story moving. "
            f"Do NOT include another [[ROLL]] tag."
        )

        # Use adventure memory so the DM remembers the full context
        history = list(adventure.conversation_log[-MAX_HISTORY_TURNS:])
        history.append({"role": "user", "content": prompt})

        try:
            response = self._client.messages.create(
                model=self._model,
                max_tokens=300,
                system=build_system_prompt(dungeon_name=adventure.name),
                messages=history,
            )
            text = response.content[0].text
            # Append resolution to memory
            adventure.conversation_log.append({"role": "user", "content": prompt})
            adventure.conversation_log.append({"role": "assistant", "content": text})
            return text
        except Exception as e:
            logger.error(f"Error resolving roll: {e}")
            if success:
                return f"With a roll of {roll_total} against DC {dc}, you succeed! Your action pays off."
            else:
                return f"With a roll of {roll_total} against DC {dc}, you fail. Something goes wrong..."

    def _fallback_action_response(self, player: Player, action: str) -> str:
        """Fallback response when API fails."""
        return f"""{player.name} attempts to {action.lower()}.

[The mystical connection to the realm flickers momentarily. The Dungeon Master's voice echoes distantly...]

Your action has been noted by the fates. The outcome remains shrouded in mystery.
Perhaps try again, or attempt something else while the cosmic threads realign."""
    
    async def describe_room(self, room: Room) -> str:
        """
        Generate an atmospheric description for a dungeon room.
        Used when a player first enters a room.
        """
        enemy_list = ", ".join(e.name for e in room.enemies if e.hp > 0) or "none"
        items_list = ", ".join(i.name for i in room.items) or "none"

        prompt = (
            f"Describe this dungeon room in 2-3 vivid, atmospheric sentences:\n\n"
            f"Room name: {room.name}\n"
            f"Room type: {room.room_type.value}\n"
            f"Enemies present: {enemy_list}\n"
            f"Items visible: {items_list}\n\n"
            f"Base description: {room.description}\n\n"
            f"Make it tense and immersive. If there are enemies, hint at their presence."
        )

        try:
            response = self._client.messages.create(
                model=self._model,
                max_tokens=256,
                system="You are a Dungeon Master writing atmospheric room descriptions for a fantasy dungeon crawler game. Be vivid but concise.",
                messages=[{"role": "user", "content": prompt}],
            )
            return response.content[0].text
        except Exception as e:
            logger.error(f"Error generating room description: {e}")
            return room.description

    async def generate_event(
        self,
        adventure: Adventure,
        event_type: str,
        context: str
    ) -> str:
        """
        Generate a world event or NPC action.
        
        Used for scheduled/timed events in the game.
        """
        prompt = f"""Adventure: {adventure.name}
Day {adventure.game_day}

A {event_type} event occurs: {context}

Write a brief (1-2 paragraph) narrative describing this event unfolding.
Make it atmospheric and potentially hook the players' interest."""

        try:
            response = self._client.messages.create(
                model=self._model,
                max_tokens=512,
                system=SYSTEM_PROMPTS.get(adventure.mode, SYSTEM_PROMPTS[AdventureMode.GUIDED]),
                messages=[{"role": "user", "content": prompt}]
            )
            
            return response.content[0].text
            
        except Exception as e:
            logger.error(f"Error generating event: {e}")
            return f"[A {event_type} event occurs: {context}]"
