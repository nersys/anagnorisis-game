"""
Dungeon Generator

Two modes:
1. generate_dungeon()             — classic fixed 7-room layout (fallback)
2. generate_dungeon_from_pois()   — real-world POIs near the player become rooms

Layout (grid positions, classic mode):
    (0,0) Start -> (1,0) Corridor -> (2,0) Chamber
                        |
                   (1,1) Treasure
                        |
                   (1,2) Chamber -> (2,2) Corridor
                                         |
                                    (2,3) Boss Room
"""

import random
from copy import deepcopy
from typing import Optional

from shared.models import Room, Enemy, Item, RoomType, ItemType
from shared.constants import (
    ENEMY_TEMPLATES,
    ITEM_TEMPLATES,
    ROOM_NAMES,
    CLASS_STARTING_INVENTORY,
)


def _make_enemy(template_key: str) -> Enemy:
    """Create an Enemy from a template."""
    t = deepcopy(ENEMY_TEMPLATES[template_key])
    is_boss = t.pop("is_boss", False)
    return Enemy(is_boss=is_boss, **t)


def _make_item(template_key: str) -> Item:
    """Create an Item from a template."""
    t = deepcopy(ITEM_TEMPLATES[template_key])
    return Item(**t)


def _room_name(room_type: str) -> str:
    names = ROOM_NAMES.get(room_type, ["Unknown Room"])
    return random.choice(names)


def generate_dungeon() -> dict[str, Room]:
    """
    Generate a complete dungeon.

    Returns a dict of room_id -> Room.
    The entrance room has a known id "start".
    """
    rooms: dict[str, Room] = {}

    # --- Room 0: Start room (safe) ---
    start = Room(
        id="r0",
        x=0, y=0,
        room_type=RoomType.START,
        name="The Entrance Chamber",
        description=(
            "Crumbling stone walls surround you. Torches flicker in iron sconces. "
            "The air smells of dust and old bones. A passage leads east."
        ),
        exits={},
        explored=True,
        cleared=True,
    )
    rooms[start.id] = start

    # --- Room 1: Corridor east of start ---
    r1 = Room(
        id="r1",
        x=1, y=0,
        room_type=RoomType.CORRIDOR,
        name=_room_name("corridor"),
        description=(
            "A narrow passage. The walls are slick with moisture. "
            "Something moves in the darkness ahead."
        ),
        exits={},
        enemies=[_make_enemy("goblin"), _make_enemy("skeleton")],
        gold=random.randint(5, 15),
    )
    rooms[r1.id] = r1

    # --- Room 2: Chamber northeast ---
    r2 = Room(
        id="r2",
        x=2, y=0,
        room_type=RoomType.CHAMBER,
        name=_room_name("chamber"),
        description=(
            "A wide guard chamber. Broken weapons litter the floor. "
            "Two brutish orcs stand watch, weapons raised."
        ),
        exits={},
        enemies=[_make_enemy("orc"), _make_enemy("goblin")],
        items=[_make_item("health_potion")],
        gold=random.randint(15, 30),
    )
    rooms[r2.id] = r2

    # --- Room 3: Treasure room (south of r1) ---
    r3 = Room(
        id="r3",
        x=1, y=1,
        room_type=RoomType.TREASURE,
        name=_room_name("treasure"),
        description=(
            "Your torch reveals glittering chests and scattered gold! "
            "No enemies here — just riches waiting to be claimed."
        ),
        exits={},
        items=[
            _make_item("health_potion"),
            _make_item("mana_potion"),
            _make_item("greater_health_potion"),
        ],
        gold=random.randint(40, 70),
        cleared=True,  # No enemies
    )
    rooms[r3.id] = r3

    # --- Room 4: Chamber south of r3 ---
    r4 = Room(
        id="r4",
        x=1, y=2,
        room_type=RoomType.CHAMBER,
        name=_room_name("chamber"),
        description=(
            "The floor is stained with old blood. Chains hang from the ceiling. "
            "A stone troll and wraith block your path forward."
        ),
        exits={},
        enemies=[_make_enemy("troll"), _make_enemy("wraith")],
        gold=random.randint(20, 40),
    )
    rooms[r4.id] = r4

    # --- Room 5: Corridor east of r4 ---
    r5 = Room(
        id="r5",
        x=2, y=2,
        room_type=RoomType.CORRIDOR,
        name=_room_name("corridor"),
        description=(
            "The temperature drops sharply. Ancient runes glow faintly on the walls. "
            "The corridor leads south to a massive iron door."
        ),
        exits={},
        enemies=[_make_enemy("skeleton"), _make_enemy("wraith")],
        items=[_make_item("health_potion")],
        gold=random.randint(10, 25),
    )
    rooms[r5.id] = r5

    # --- Room 6: Boss room ---
    # Randomly choose boss
    boss_key = random.choice(["dragon_boss", "lich_boss"])
    r6 = Room(
        id="r6",
        x=2, y=3,
        room_type=RoomType.BOSS,
        name=_room_name("boss"),
        description=(
            "A vast chamber opens before you. Ancient pillars rise into darkness above. "
            "At the far end, bathed in sickly light, the final guardian awaits."
        ),
        exits={},
        enemies=[_make_enemy(boss_key)],
        items=[
            _make_item("greater_health_potion"),
            _make_item("mana_potion"),
        ],
        gold=random.randint(80, 150),
    )
    rooms[r6.id] = r6

    # --- Wire up exits ---
    # start <-> r1 (east/west)
    start.exits["east"] = r1.id
    r1.exits["west"] = start.id

    # r1 <-> r2 (east/west)
    r1.exits["east"] = r2.id
    r2.exits["west"] = r1.id

    # r1 <-> r3 (south/north)
    r1.exits["south"] = r3.id
    r3.exits["north"] = r1.id

    # r3 <-> r4 (south/north)
    r3.exits["south"] = r4.id
    r4.exits["north"] = r3.id

    # r4 <-> r5 (east/west)
    r4.exits["east"] = r5.id
    r5.exits["west"] = r4.id

    # r5 <-> r6 (south/north)
    r5.exits["south"] = r6.id
    r6.exits["north"] = r5.id

    return rooms


# ── Enemy pool by game role ───────────────────────────────────────────────────

_ROLE_ENEMIES: dict[str, list[list[str]]] = {
    "training_hall":  [["orc", "goblin"], ["orc"]],
    "grove":          [["goblin", "goblin"], ["goblin", "wraith"]],
    "cursed_ground":  [["skeleton", "wraith"], ["skeleton", "skeleton"]],
    "ancient_altar":  [["troll", "wraith"], ["wraith"]],
    "arena":          [["orc", "troll"]],
    "warrior_hall":   [["orc"]],
    "mage_tower":     [["skeleton"]],
    "ancient_archive":  [["wraith"]],
    "mystery":        [["goblin"], ["skeleton"]],
    "waypoint":       [["goblin"]],
    "beast":          [["goblin", "goblin"]],   # nature enemies
    "gladiator":      [["orc"]],
    "rival":          [["orc", "goblin"]],
    "undead":         [["skeleton", "wraith"]],
    "guardian":       [["troll"]],
    "pickpocket":     [["goblin"]],
    "random":         [["goblin"], ["skeleton"], ["orc"]],
}


def _get_enemies_for_role(enemy_theme: str, is_boss: bool) -> list[Enemy]:
    """Return an enemy list appropriate for the given role/theme."""
    if is_boss:
        boss_key = random.choice(["dragon_boss", "lich_boss"])
        return [_make_enemy(boss_key)]

    pools = _ROLE_ENEMIES.get(enemy_theme, [["goblin"]])
    chosen = random.choice(pools)
    return [_make_enemy(k) for k in chosen]


# ── Real-world POI dungeon generator ─────────────────────────────────────────

def generate_dungeon_from_pois(
    pois: list[dict],
    player_lat: float,
    player_lng: float,
) -> dict[str, Room]:
    """
    Build a dungeon from real-world POIs near the player.

    - r0 = player's actual GPS position (safe start)
    - r1 … rN = nearest classified OSM POIs (up to 7)
    - Last room = boss (farthest non-safe location, or forced boss)
    - Exits use "forward" / "back" (linear chain through real distance order)

    Falls back to generate_dungeon() if no POIs are available.
    """
    if not pois:
        return generate_dungeon()

    rooms: dict[str, Room] = {}

    # --- Room 0: player's real position (always safe) ---
    start = Room(
        id="r0",
        x=0, y=0,
        room_type=RoomType.START,
        name="Your Location",
        description=(
            "You stand at your starting point. The city hums with hidden energy. "
            "Every building, every corner, every park — the dungeon unfolds around you."
        ),
        exits={},
        explored=True,
        cleared=True,
        lat=player_lat,
        lng=player_lng,
        game_role="start",
    )
    rooms["r0"] = start

    # POIs are already sorted by distance ascending
    selected = pois[:7]

    # Force last room to be BOSS if possible
    boss_idx = len(selected) - 1

    for i, poi in enumerate(selected):
        room_id = f"r{i + 1}"
        is_boss = (i == boss_idx)

        # Override room type to BOSS for the final room (unless it's already safe & the only option)
        if is_boss and not poi["is_safe"]:
            room_type = RoomType.BOSS
        elif is_boss and poi["is_safe"] and len(selected) == 1:
            room_type = RoomType.BOSS  # no choice
            is_boss = True
        else:
            _type_map = {
                "corridor": RoomType.CORRIDOR,
                "chamber":  RoomType.CHAMBER,
                "treasure": RoomType.TREASURE,
                "boss":     RoomType.BOSS,
                "start":    RoomType.START,
            }
            room_type = _type_map.get(poi["room_type"], RoomType.CORRIDOR)

        # Enemies
        enemies: list[Enemy] = []
        if is_boss:
            enemies = _get_enemies_for_role(poi["enemy_theme"], is_boss=True)
        elif not poi["is_safe"]:
            enemies = _get_enemies_for_role(poi["enemy_theme"], is_boss=False)

        # Loot
        loot_tier: int = poi.get("loot_tier", 0)
        items: list[Item] = []
        if loot_tier >= 1:
            items.append(_make_item("health_potion"))
        if loot_tier >= 2:
            items.append(_make_item("mana_potion"))
        if loot_tier >= 3:
            items.append(_make_item("greater_health_potion"))

        # Gold
        gold_by_tier = {0: 0, 1: random.randint(5, 20), 2: random.randint(15, 40), 3: random.randint(40, 100)}
        gold = random.randint(80, 150) if is_boss else gold_by_tier.get(loot_tier, 0)

        room = Room(
            id=room_id,
            x=i + 1, y=0,
            room_type=room_type,
            name=poi["name"],
            description=_enrich_description(poi),
            exits={},
            enemies=enemies,
            items=items,
            gold=gold,
            cleared=poi["is_safe"] and not is_boss,
            lat=poi["lat"],
            lng=poi["lng"],
            osm_id=poi.get("osm_id"),
            game_role=poi["game_role"],
            distance_m=poi.get("distance_m"),
            services=poi.get("services", []),
        )
        rooms[room_id] = room

    # --- Wire up exits: linear chain using forward/back ---
    room_ids = list(rooms.keys())
    for i in range(len(room_ids) - 1):
        a = room_ids[i]
        b = room_ids[i + 1]
        rooms[a].exits["forward"] = b
        rooms[b].exits["back"] = a

    return rooms


def _enrich_description(poi: dict) -> str:
    """Add distance context to a POI's atmospheric description."""
    dist = poi.get("distance_m", 0)
    base = poi["description"]
    emoji = poi.get("emoji", "📍")
    if dist < 100:
        context = "It looms right before you."
    elif dist < 300:
        context = f"A short walk — {dist}m away."
    elif dist < 600:
        context = f"About {dist}m from where you stand."
    else:
        context = f"Some {dist}m distant, calling to you."
    return f"{base} {emoji} {context}"
