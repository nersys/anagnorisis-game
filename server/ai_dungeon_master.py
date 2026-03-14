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
from typing import Optional

from anthropic import Anthropic, APIError

from shared.models import Adventure, Player, AdventureMode, Room

logger = logging.getLogger("anagnorisis.dm")


# System prompts for different adventure modes
SYSTEM_PROMPTS = {
    AdventureMode.FREEFORM: """You are the Dungeon Master for a freeform fantasy RPG adventure. 
You have complete creative freedom to craft the narrative. 
Be descriptive, dramatic, and responsive to player actions.
Create interesting NPCs, locations, and challenges on the fly.
Keep responses to 2-3 paragraphs for good pacing.""",
    
    AdventureMode.STRUCTURED: """You are the Dungeon Master for a structured fantasy RPG adventure.
Follow traditional D&D-style rules strictly:
- Request dice rolls for skill checks (specify DC)
- Track combat with initiative and turns
- Enforce class abilities and spell slots
- Apply damage and healing precisely
Keep responses focused on mechanics while maintaining narrative flavor.""",
    
    AdventureMode.GUIDED: """You are the Dungeon Master for a guided fantasy RPG adventure.
Balance narrative freedom with game structure:
- Use skill checks for uncertain outcomes
- Keep combat engaging but not overly complex
- Allow creative solutions while maintaining challenge
- Weave character backstories into the narrative
Be descriptive and atmospheric. 2-3 paragraphs per response.""",
}


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
    
    async def generate_intro(self, adventure: Adventure, party: list[Player]) -> str:
        """
        Generate the opening narrative for an adventure.
        """
        party_context = self._build_party_context(party)
        
        prompt = f"""Begin a new adventure called "{adventure.name}".

Adventure Description: {adventure.description}

{party_context}

Write an atmospheric opening that:
1. Sets the scene and establishes the mood
2. Introduces the initial situation or hook
3. Gives players a clear sense of what they might do next

Keep it to 2-3 paragraphs. Be vivid and engaging."""

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
        conversation_history: Optional[list[dict]] = None
    ) -> str:
        """
        Process a player action and generate the DM response.
        
        Args:
            adventure: The current adventure
            acting_player: The player taking the action
            party: All party members
            action: What the player wants to do
            conversation_history: Previous exchanges (for context)
        
        Returns:
            The DM's narrative response
        """
        party_context = self._build_party_context(party)
        
        prompt = f"""Current Adventure: {adventure.name}
Day {adventure.game_day}

{party_context}

{acting_player.name} the {acting_player.player_class.value} says: "{action}"

Respond as the Dungeon Master:
- Describe the outcome of their action
- Include any relevant skill checks or rolls if appropriate
- Advance the story naturally
- End with the new situation or subtle prompt for next action

Keep response to 2-3 paragraphs."""

        # Build messages including history if provided
        messages = []
        if conversation_history:
            messages.extend(conversation_history[-10:])  # Last 10 exchanges for context
        messages.append({"role": "user", "content": prompt})
        
        try:
            response = self._client.messages.create(
                model=self._model,
                max_tokens=1024,
                system=SYSTEM_PROMPTS.get(adventure.mode, SYSTEM_PROMPTS[AdventureMode.GUIDED]),
                messages=messages
            )
            
            return response.content[0].text
            
        except APIError as e:
            logger.error(f"API error processing action: {e}")
            return self._fallback_action_response(acting_player, action)
        except Exception as e:
            logger.error(f"Error processing action: {e}")
            return self._fallback_action_response(acting_player, action)
    
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
