"""
Dungeon Generator

Generates a playable dungeon with rooms, enemies, and items.
Each adventure gets a fresh dungeon layout.

Layout (grid positions):
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
