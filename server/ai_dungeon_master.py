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
        self._personality: str = "balanced"
        self._personality_notes: str = ""
        logger.info(f"AI DM initialized with model: {self._model}")

    def update_personality(self, personality: str, personality_notes: str = "") -> None:
        """Update DM personality. Takes effect on the next turn."""
        self._personality = personality
        self._personality_notes = personality_notes
        logger.info(f"DM personality updated: {personality}")
    
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
            # Use full lore for the intro so the DM knows the campaign arc from the start
            system = build_system_prompt(
                dungeon_name=adventure.name,
                personality=self._personality,
                personality_notes=self._personality_notes,
                include_full_lore=True,
            )
            response = self._client.messages.create(
                model=self._model,
                max_tokens=1024,
                system=system,
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

        system = build_system_prompt(
            dungeon_name=adventure.name,
            personality=self._personality,
            personality_notes=self._personality_notes,
        )

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
        margin = roll_total - dc

        if success:
            if margin >= 5:
                degree = "CRITICAL SUCCESS — they exceed expectations. Describe something exceptional happening beyond the basic goal."
            else:
                degree = "NARROW SUCCESS — they just barely manage it. They achieve the goal but perhaps with effort or a minor hitch."
        else:
            if margin <= -5:
                degree = "CRITICAL FAILURE — something goes badly wrong. A clear setback, complication, or unintended consequence occurs."
            else:
                degree = "NARROW FAILURE — they come very close but fall short. The task fails, with a clear visible downside."

        prompt = (
            f"=== DICE ROLL RESOLUTION ===\n"
            f"Player action: \"{original_action}\"\n"
            f"Your setup: {setup_narrative}\n\n"
            f"Roll: {die} + {stat} mod = {roll_total}  |  DC {dc}  |  RESULT: *** {outcome} *** ({degree})\n\n"
            f"MANDATORY RULES:\n"
            f"1. The outcome is {outcome} — you MUST honor it. Never reverse or soften it.\n"
            f"2. On SUCCESS: show specifically how \"{original_action}\" succeeds — what happens, what changes.\n"
            f"   On FAILURE: show specifically how \"{original_action}\" fails — what goes wrong, what the consequence is.\n"
            f"3. Be concrete and tied to THIS specific action — no generic 'you try hard' filler.\n"
            f"4. 2-3 tight sentences. End on a new hook, threat, or choice.\n"
            f"5. Do NOT embed a [[ROLL]] tag."
        )

        # Use adventure memory so the DM remembers the full context
        history = list(adventure.conversation_log[-MAX_HISTORY_TURNS:])
        history.append({"role": "user", "content": prompt})

        try:
            response = self._client.messages.create(
                model=self._model,
                max_tokens=350,
                system=build_system_prompt(
                    dungeon_name=adventure.name,
                    personality=self._personality,
                    personality_notes=self._personality_notes,
                ),
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
            system = build_system_prompt(
                personality=self._personality,
                personality_notes=self._personality_notes,
            )
            response = self._client.messages.create(
                model=self._model,
                max_tokens=256,
                system=system,
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
                system=build_system_prompt(
                    dungeon_name=adventure.name,
                    personality=self._personality,
                    personality_notes=self._personality_notes,
                ),
                messages=[{"role": "user", "content": prompt}]
            )
            
            return response.content[0].text
            
        except Exception as e:
            logger.error(f"Error generating event: {e}")
            return f"[A {event_type} event occurs: {context}]"

    async def generate_death_narrative(self, player, adventure, stats: dict) -> str:
        """Generate a dramatic, class-appropriate death narrative."""
        cls = getattr(player, 'player_class', 'warrior')
        cls_str = cls.value if hasattr(cls, 'value') else str(cls)
        prompt = (
            f"The {cls_str} named {player.name} has fallen in battle.\n"
            f"Adventure: {adventure.name}\n"
            f"Stats: {stats.get('rooms_cleared',0)} rooms cleared, "
            f"{stats.get('enemies_slain',0)} enemies slain, "
            f"{stats.get('gold_found',0)} gold found, "
            f"{stats.get('turns_played',0)} turns survived.\n\n"
            "Write a 3-sentence death narrative that is dramatic, class-appropriate, "
            "and honors the player's journey. End with a haunting final image. "
            "Do NOT mention stats or numbers directly — make it poetic."
        )
        try:
            response = self._client.messages.create(
                model=self._model, max_tokens=150,
                system=build_system_prompt(dungeon_name=adventure.name,
                    personality=self._personality, personality_notes=self._personality_notes),
                messages=[{"role": "user", "content": prompt}]
            )
            return response.content[0].text
        except Exception as e:
            logger.error(f"Death narrative error: {e}")
            class_deaths = {
                "warrior": "The warrior falls, shield arm outstretched, defiant to the last breath.",
                "mage": "The mage's last spell unravels into silence, arcane light fading from their eyes.",
                "rogue": "The rogue vanishes into shadow — this time, they don't return.",
                "cleric": "The cleric's prayer ends mid-word. The gods remain silent.",
                "ranger": "The ranger's final arrow flies true — but it is not enough.",
            }
            return class_deaths.get(cls_str, "The adventurer falls, their story unfinished.")

    async def generate_victory_narrative(self, player, adventure, stats: dict) -> str:
        """Generate a triumphant victory narrative."""
        cls = getattr(player, 'player_class', 'warrior')
        cls_str = cls.value if hasattr(cls, 'value') else str(cls)
        prompt = (
            f"The {cls_str} named {player.name} has conquered the dungeon!\n"
            f"Adventure: {adventure.name}\n"
            f"They reached level {player.stats.level}, cleared {stats.get('rooms_cleared',0)} rooms, "
            f"slew {stats.get('enemies_slain',0)} enemies, and found {stats.get('gold_found',0)} gold.\n\n"
            "Write a 3-sentence victory narrative that is triumphant but bittersweet — "
            "the Veil still exists, the Archivist still stirs. The battle is won, not the war. "
            "End with a sense of the journey continuing."
        )
        try:
            response = self._client.messages.create(
                model=self._model, max_tokens=150,
                system=build_system_prompt(dungeon_name=adventure.name,
                    personality=self._personality, personality_notes=self._personality_notes),
                messages=[{"role": "user", "content": prompt}]
            )
            return response.content[0].text
        except Exception as e:
            logger.error(f"Victory narrative error: {e}")
            return (
                f"{player.name} stands victorious over the fallen. "
                "The dungeon is cleared, but the city still breathes with shadow. "
                "Somewhere, the Archivist stirs — and takes note of your name."
            )

    async def narrate_npc_encounter(self, player, adventure, npc: dict, room_name: str) -> str:
        """Generate dynamic NPC encounter narrative."""
        cls = getattr(player, 'player_class', 'warrior')
        cls_str = cls.value if hasattr(cls, 'value') else str(cls)
        prompt = (
            f"The {cls_str} {player.name} encounters {npc['name']} ({npc['role']}) "
            f"at {room_name}.\n"
            f"Their opening line: \"{npc['first_encounter']}\"\n"
            f"Campaign context: {npc.get('tip', 'They seem to know something.')}\n\n"
            "Expand this into a 2-3 sentence scene description that sets the mood before "
            "the NPC speaks. Then write their opening line verbatim. "
            "Make the setting feel real and tense."
        )
        try:
            response = self._client.messages.create(
                model=self._model, max_tokens=200,
                system=build_system_prompt(dungeon_name=adventure.name,
                    personality=self._personality, personality_notes=self._personality_notes),
                messages=[{"role": "user", "content": prompt}]
            )
            return response.content[0].text
        except Exception as e:
            logger.error(f"NPC narrative error: {e}")
            return f"{npc['name']} appears. {npc['first_encounter']}"
