"""
server/story.py — The Overarching Narrative of Anagnorisis
===========================================================

This file defines the master story that the Dungeon Master and Companion
both reference. Change this file to run a different campaign without touching
game logic.

The story is injected into:
  - AIDungeonMaster system prompt (every action/room description)
  - Companion chat context (every companion response)
  - Adventure intro generation

To run a new campaign: edit CAMPAIGN below, restart the server.
"""

# ─────────────────────────────────────────────────────────────
# ACTIVE CAMPAIGN  (swap this dict to change the whole story)
# ─────────────────────────────────────────────────────────────

CAMPAIGN = {
    # Short identifier used in logs
    "id": "the_veil_of_anagnorisis",

    # Displayed as the default adventure name in the lobby
    "default_adventure_name": "The Veil of Anagnorisis",

    # One-sentence hook shown on the lobby/intro screen
    "hook": (
        "A tear in reality has opened beneath your city. "
        "Ancient evil bleeds through — disguised as the ordinary world."
    ),

    # The full lore block injected into the DM system prompt.
    # Keep it under 600 tokens — the DM needs room to improvise.
    "lore": """
THE VEIL OF ANAGNORISIS — Campaign Lore (DM Reference)

THE CORE PREMISE:
The city is infected. A tear called the Veil has opened between the mundane
world and the Shadow Realm — a dimension of old gods, cursed knowledge, and
hungry darkness. Most people cannot perceive it. The players can.

Ordinary city locations have been corrupted:
- Churches and schools have become nodes where the Veil is thin — prayers
  and lessons accidentally feed the Shadow.
- Bars and restaurants are recruitment grounds for cultists — they call
  themselves the "Waking Eyes."
- Gyms and sports facilities are where the Veil-touched sharpen for war.
- Hospitals and clinics have healers who unknowingly tend to both the living
  and to shadow-creatures taking human form.
- Parks and open spaces are where the Veil literally tears open at night.

THE ANTAGONIST — The Archivist:
An ancient entity that once catalogued forbidden knowledge. It was sealed
beneath the city centuries ago. Now it is waking. It wants three things:
1. The Tome of Unmaking — a book that can rewrite reality, split across
   three locations in the city.
2. A Host — a living body strong enough to contain its full form.
3. The Anagnorisis — the moment of collective revelation when enough humans
   simultaneously recognize the true nature of reality. This would tear the
   Veil permanently open.

THE PLAYERS' ROLE:
The players are Veil-Touched — ordinary people who began seeing through the
illusion after an incident the DM should tie to the adventure intro. They
are not heroes by training. They are people who cannot look away.

ACTS (DM should track progress naturally — do not announce act breaks):
ACT I — RECOGNITION: Players begin to understand what they're seeing. NPCs
  dismiss them. The Waking Eyes are watching but not yet hostile.
ACT II — HUNT: The Archivist becomes aware of the players. Cultists receive
  orders. Familiar places become dangerous. Players learn about the Tome.
ACT III — CONVERGENCE: A full moon / city-wide event (concert, protest,
  festival) will trigger the Anagnorisis. Players must either find and destroy
  all three Tome fragments OR find a way to seal the Veil before the event.

TONE GUIDANCE:
- Urban gothic. Gritty but with moments of genuine wonder.
- The horror is psychological before it is physical.
- NPCs are not stupid. Some know the truth and chose to ignore it.
- The city itself is a character — traffic, noise, weather all react to Veil
  activity. A sudden storm means the Archivist is near.
- Los Angeles as a setting: the city's obsession with fame, appearance, and
  reinvention is weaponized by the Shadow. The Veil makes the artificial real
  and the real artificial.

RECURRING NPCS (DM should use these and build on them):
- MARISOL VEGA — city archivist (city hall records). Knows more than she
  admits. Provides intel but is terrified of the Waking Eyes.
- DETECTIVE OMAR RAINES — LAPD. Investigating the "missing persons" cases
  that are actually Veil absorptions. Skeptical but honest.
- THE SACRISTAN — identity unknown. Leaves cryptic notes at Veil sites.
  May be a former Archivist servant who broke free — or a trap.
- WAKING EYES LIEUTENANT: present location chosen from real nearby POIs.
  Name changes each run. Always wearing something red.
""",

    # Short version for the DM to use in room descriptions — just the core facts
    "dm_reminder": (
        "CAMPAIGN: The Veil of Anagnorisis. "
        "Players are Veil-Touched — they see through the Shadow infecting ordinary city locations. "
        "The Archivist (ancient entity) wants to tear the Veil permanently open. "
        "Cultists called the Waking Eyes lurk among ordinary people. "
        "Stakes: the soul of the city. Tone: urban gothic, psychological horror, wonder."
    ),

    # What the companion knows and uses for framing their advice
    "companion_context": (
        "You are a companion to Veil-Touched adventurers in a modern city "
        "where reality itself is fracturing. An ancient entity called the Archivist "
        "has infected ordinary places — churches, bars, gyms — with Shadow energy. "
        "Cultists called the Waking Eyes serve it. "
        "The players must find the three fragments of the Tome of Unmaking and "
        "seal the Veil before the Anagnorisis — the moment of mass awakening — tears it open forever. "
        "When advising, reference the Veil, the Archivist, or the Waking Eyes as appropriate. "
        "Treat the city's real locations as genuinely dangerous and significant."
    ),
}


def get_dm_story_context() -> str:
    """Return the full lore block for injection into DM system prompts."""
    return CAMPAIGN["lore"].strip()


def get_dm_reminder() -> str:
    """Return a brief campaign reminder for per-turn DM context."""
    return CAMPAIGN["dm_reminder"]


def get_companion_context() -> str:
    """Return the campaign context string for companion chat."""
    return CAMPAIGN["companion_context"]


def get_default_adventure_name() -> str:
    return CAMPAIGN["default_adventure_name"]


def get_hook() -> str:
    return CAMPAIGN["hook"]
