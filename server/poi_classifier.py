"""
POI Classifier — Maps OpenStreetMap tags to game location types.

Every real-world place becomes a meaningful node in the game world.
The city IS the dungeon.
"""

import math
import random
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class GameLocation:
    game_role: str          # tavern, training_hall, mage_tower, etc.
    emoji: str              # display emoji
    room_type: str          # corridor, chamber, treasure, boss, start
    description: str        # atmospheric flavour text
    enemy_theme: str        # what enemy pool to draw from (or "none")
    loot_tier: int          # 0=none 1=low 2=mid 3=high
    is_safe: bool           # if True, no enemies spawn
    services: list = field(default_factory=list)  # heal_full, train_str, etc.


# ── OSM amenity tag → game classification ────────────────────────────────────

AMENITY_MAP: dict[str, GameLocation] = {
    # Taverns & food — healing hubs
    "bar":          GameLocation("tavern",        "🍺", "corridor",
        "Golden lantern-light spills through smoke-stained windows. The smell of ale and old wood fills the air.",
        "brawler", 1, True, ["heal_partial", "buy_potions"]),
    "pub":          GameLocation("tavern",        "🍺", "corridor",
        "Weathered adventurers nurse their drinks. The barkeep eyes you warily.",
        "brawler", 1, True, ["heal_partial", "buy_potions"]),
    "nightclub":    GameLocation("tavern",        "🎵", "corridor",
        "Pulsing lights and revelry mask the shadowy dealings within.",
        "trickster", 1, True, ["heal_partial"]),
    "restaurant":   GameLocation("inn",           "🍖", "corridor",
        "The scent of roasting meat drifts from the kitchen. A warm fire crackles nearby.",
        "none", 1, True, ["heal_partial"]),
    "fast_food":    GameLocation("inn",           "🥡", "corridor",
        "Quick sustenance for weary travelers. Not glamorous, but effective.",
        "none", 0, True, ["heal_minor"]),
    "cafe":         GameLocation("inn",           "☕", "corridor",
        "The aroma of strong brew steadies the nerves of even the most battle-worn.",
        "none", 0, True, ["heal_minor", "mana_restore"]),
    "food_court":   GameLocation("inn",           "🍱", "corridor",
        "Many vendors, many choices. Energy is energy.",
        "none", 1, True, ["heal_minor"]),

    # Training — combat stat boosts
    "gym":              GameLocation("training_hall", "⚔️", "chamber",
        "Iron clangs against iron. Sweating warriors push their bodies to the limit in this sacred hall of pain.",
        "gladiator", 2, False, ["train_str", "train_dex"]),
    "fitness_centre":   GameLocation("training_hall", "⚔️", "chamber",
        "Rows of equipment stand ready. The smell of sweat and ambition fills the air.",
        "gladiator", 2, False, ["train_str", "train_dex"]),
    "sports_centre":    GameLocation("training_hall", "🏹", "chamber",
        "Athletes spar and drill. A worthy place to hone your combat skills.",
        "rival", 2, False, ["train_str", "train_dex"]),
    "dojo":             GameLocation("training_hall", "🥋", "chamber",
        "Discipline is the first weapon. The second is what you learn here.",
        "gladiator", 2, False, ["train_str", "train_dex"]),

    # Knowledge — magic and INT
    "library":          GameLocation("mage_tower",  "📚", "corridor",
        "Ancient tomes line every wall. The silence is broken only by rustling pages and the hum of stored knowledge.",
        "none", 0, True, ["learn_skill", "gain_int"]),
    "university":       GameLocation("academy",     "🎓", "chamber",
        "Scholars debate arcane theories. Knowledge here is hard-won but powerful.",
        "scholar_ghost", 2, True, ["learn_skill", "gain_int"]),
    "school":           GameLocation("academy",     "🎓", "corridor",
        "Young minds are shaped here. The echoes of countless lessons linger in the walls.",
        "none", 0, True, ["gain_int"]),
    "college":          GameLocation("academy",     "🎓", "corridor",
        "Higher learning, higher stakes.",
        "none", 0, True, ["learn_skill", "gain_int"]),

    # Healing / medical
    "hospital":     GameLocation("healer_shrine",  "✨", "treasure",
        "Sanctified halls where the art of healing reaches its apex. The air itself feels restorative.",
        "none", 0, True, ["heal_full", "cure_status"]),
    "clinic":       GameLocation("healer_shrine",  "⚕️", "treasure",
        "A place of mending. Skilled healers tend to the wounded without question.",
        "none", 0, True, ["heal_partial", "cure_status"]),
    "pharmacy":     GameLocation("healer_shrine",  "💊", "corridor",
        "Shelves lined with remedies both mundane and mystical.",
        "none", 1, True, ["heal_minor", "buy_potions"]),
    "doctors":      GameLocation("healer_shrine",  "⚕️", "corridor",
        "A healer's modest practice. They've seen injuries of all kinds.",
        "none", 0, True, ["heal_partial"]),
    "dentist":      GameLocation("healer_shrine",  "🦷", "corridor",
        "The bravest visit willingly. Even warriors flinch.",
        "none", 0, True, ["heal_minor"]),

    # Spiritual — MP and buffs
    "place_of_worship": GameLocation("temple",     "🙏", "treasure",
        "A sacred space where the boundary between worlds grows thin. The devout find strength here.",
        "undead", 1, True, ["mana_full", "add_buff"]),

    # Commerce
    "bank":         GameLocation("merchant_guild", "💰", "treasure",
        "Gold flows through these halls like blood. The merchants here deal in power as much as coin.",
        "none", 2, True, ["buy_items", "sell_items"]),
    "atm":          GameLocation("merchant_guild", "💰", "corridor",
        "A small exchange point. Convenient, if not impressive.",
        "none", 1, True, ["buy_items"]),
    "marketplace":  GameLocation("merchant_guild", "🏪", "treasure",
        "Merchants hawk their wares. Anything can be found here for a price.",
        "none", 2, True, ["buy_items", "sell_items"]),

    # Culture / CHA
    "cinema":       GameLocation("bardic_stage",   "🎭", "corridor",
        "Stories projected in light and shadow. The bards here speak to thousands at once.",
        "none", 0, True, ["gain_cha"]),
    "theatre":      GameLocation("bardic_stage",   "🎭", "corridor",
        "The stage holds power beyond mere entertainment — tales shape reality.",
        "none", 0, True, ["gain_cha", "add_buff"]),
    "arts_centre":  GameLocation("bardic_stage",   "🎨", "corridor",
        "Creativity made manifest. Those who walk these halls leave changed.",
        "none", 0, True, ["gain_cha"]),
    "music_venue":  GameLocation("bardic_stage",   "🎵", "corridor",
        "The vibrations of sound carry magic older than any spell.",
        "none", 0, True, ["gain_cha", "add_buff"]),

    # General stores
    "supermarket":  GameLocation("general_store",  "🏪", "corridor",
        "Supplies of every kind, mundane and useful.",
        "none", 1, True, ["buy_potions", "buy_items"]),
    "convenience":  GameLocation("general_store",  "🏪", "corridor",
        "A small cache of supplies. Better than nothing.",
        "none", 0, True, ["buy_potions"]),

    # Law enforcement / safe zones
    "police":       GameLocation("guard_post",     "🛡️", "start",
        "The enforcers of order hold vigil here. Enemies dare not attack in their shadow.",
        "none", 0, True, []),
    "fire_station": GameLocation("warrior_hall",   "🔥", "chamber",
        "Warriors of a different kind train here. Their discipline is absolute.",
        "guardian", 1, False, ["train_str"]),

    # Cursed / undead
    "cemetery":     GameLocation("cursed_ground",  "💀", "boss",
        "Death hangs heavy in the air. The dead do not rest easy here.",
        "undead", 3, False, ["rare_loot"]),
    "funeral_home": GameLocation("cursed_ground",  "⚰️", "chamber",
        "A place of endings. Something stirs in the embalming room.",
        "undead", 2, False, ["rare_loot"]),

    # Transit
    "bus_station":  GameLocation("waypoint",       "🚌", "corridor",
        "A crossroads of many journeys. Travelers from all walks converge here.",
        "pickpocket", 1, False, []),
    "taxi":         GameLocation("waypoint",        "🚕", "corridor",
        "A swift passage point for those who know how to negotiate.",
        "none", 0, True, []),
}

# ── OSM leisure tag → game classification ─────────────────────────────────────

LEISURE_MAP: dict[str, GameLocation] = {
    "park":             GameLocation("grove",          "🌿", "chamber",
        "Ancient trees form a canopy overhead. The city noise fades. Something wild watches from the shadows.",
        "beast", 2, False, ["ranger_skills", "heal_minor"]),
    "nature_reserve":   GameLocation("grove",          "🌿", "chamber",
        "Wilderness preserved within the urban sprawl. The old spirits are restless.",
        "beast", 2, False, ["ranger_skills"]),
    "garden":           GameLocation("grove",          "🌸", "corridor",
        "Cultivated beauty disguising wilder energies beneath.",
        "none", 0, True, ["heal_minor"]),
    "sports_centre":    GameLocation("training_hall",  "⚔️", "chamber",
        "Competition is the forge of warriors.",
        "rival", 2, False, ["train_dex"]),
    "stadium":          GameLocation("arena",           "🏟️", "boss",
        "A colosseum of modern times. The crowd's roar echoes across ages. Champions are made and broken here.",
        "gladiator", 3, False, ["train_str", "train_dex"]),
    "swimming_pool":    GameLocation("training_hall",  "💧", "corridor",
        "Endurance is built stroke by stroke.",
        "none", 0, True, ["train_dex"]),
    "playground":       GameLocation("grove",          "🌳", "corridor",
        "Once a place of childhood. Now something else lingers.",
        "none", 0, True, []),
    "fitness_centre":   GameLocation("training_hall",  "⚔️", "chamber",
        "The machines here shape bodies and wills alike.",
        "rival", 2, False, ["train_str"]),
    "recreation_ground":GameLocation("grove",          "🌿", "corridor",
        "Open ground where battles both ancient and recent have been fought.",
        "beast", 1, False, []),
}

# ── OSM tourism tag → game classification ─────────────────────────────────────

TOURISM_MAP: dict[str, GameLocation] = {
    "museum":       GameLocation("ancient_archive",  "🏛️", "corridor",
        "Artifacts of countless ages fill these halls. Each one carries the weight of history — and its dangers.",
        "animated_artifact", 1, False, ["gain_int", "bonus_xp"]),
    "gallery":      GameLocation("ancient_archive",  "🖼️", "corridor",
        "Art is power made visible. These works hold more than meets the eye.",
        "none", 0, True, ["gain_cha", "bonus_xp"]),
    "monument":     GameLocation("ancient_altar",    "⚱️", "boss",
        "A place where history crystallised into stone. The power here is immense — and contested.",
        "guardian", 3, False, ["legendary_loot", "bonus_xp"]),
    "memorial":     GameLocation("ancient_altar",    "🕯️", "chamber",
        "Grief made permanent. The echoes of the past cling to this place.",
        "undead", 2, False, ["rare_loot"]),
    "attraction":   GameLocation("ancient_altar",    "⚱️", "boss",
        "A place of power and legend. Adventures begin and end here.",
        "guardian", 3, False, ["legendary_loot"]),
    "viewpoint":    GameLocation("overlook",         "🔭", "corridor",
        "From high ground, all paths become clear.",
        "none", 0, True, ["reveal_map"]),
    "artwork":      GameLocation("ancient_altar",    "🎨", "corridor",
        "The boundary between creation and magic blurs here.",
        "none", 0, True, ["gain_cha"]),
    "hotel":        GameLocation("inn",              "🏨", "treasure",
        "A place of rest and restoration for weary travelers.",
        "none", 0, True, ["heal_full", "mana_full"]),
    "hostel":       GameLocation("inn",              "🏨", "corridor",
        "Cheap beds and cheaper company. But a bed is a bed.",
        "none", 0, True, ["heal_partial"]),
    "information":  GameLocation("overlook",         "ℹ️", "corridor",
        "Knowledge of the terrain is half the battle.",
        "none", 0, True, []),
    "picnic_site":  GameLocation("grove",            "🌿", "corridor",
        "A resting spot where nature breathes freely.",
        "none", 0, True, ["heal_minor"]),
}

# ── OSM historic tag → game classification ────────────────────────────────────

HISTORIC_MAP: dict[str, GameLocation] = {
    "castle":       GameLocation("ancient_altar",    "🏰", "boss",
        "Ancient stone holds ancient power. The spirits of defenders past still walk these halls.",
        "undead", 3, False, ["legendary_loot"]),
    "ruins":        GameLocation("ancient_altar",    "🏚️", "boss",
        "Crumbled walls whisper of former glory. The rubble conceals both treasure and terror.",
        "undead", 3, False, ["legendary_loot"]),
    "monument":     GameLocation("ancient_altar",    "🗿", "boss",
        "Legends made stone. The power here has never diminished.",
        "guardian", 3, False, ["legendary_loot"]),
    "building":     GameLocation("ancient_archive",  "🏛️", "chamber",
        "Old walls that have witnessed centuries of human drama.",
        "undead", 1, False, ["rare_loot"]),
    "manor":        GameLocation("ancient_archive",  "🏛️", "boss",
        "The estate of a powerful family. Old money and old grudges.",
        "undead", 3, False, ["legendary_loot"]),
    "memorial":     GameLocation("ancient_altar",    "🕯️", "chamber",
        "Grief made permanent. The echoes of the past cling.",
        "undead", 2, False, ["rare_loot"]),
    "city_gate":    GameLocation("ancient_altar",    "🚪", "boss",
        "The boundary of the old city. Something guards the threshold still.",
        "guardian", 3, False, ["legendary_loot"]),
    "milestone":    GameLocation("overlook",         "🗺️", "corridor",
        "A marker of distances past. How far have you come?",
        "none", 0, True, []),
}

# ── OSM shop tag → game classification ───────────────────────────────────────

SHOP_MAP: dict[str, GameLocation] = {
    "supermarket":  GameLocation("general_store",   "🏪", "corridor",
        "Endless aisles of supplies.", "none", 1, True, ["buy_potions", "buy_items"]),
    "convenience":  GameLocation("general_store",   "🏪", "corridor",
        "Quick supplies for the discerning adventurer.", "none", 0, True, ["buy_potions"]),
    "weapons":      GameLocation("armory",          "⚔️", "treasure",
        "Blades and bows of every description. The weaponsmith's art on full display.",
        "none", 2, True, ["buy_weapons", "upgrade_gear"]),
    "armor":        GameLocation("armory",          "🛡️", "treasure",
        "Protection for every body type and battle style.",
        "none", 2, True, ["buy_armor", "upgrade_gear"]),
    "books":        GameLocation("mage_tower",      "📚", "corridor",
        "Knowledge compressed into portable form.", "none", 0, True, ["learn_skill", "gain_int"]),
    "herbalist":    GameLocation("healer_shrine",   "🌿", "corridor",
        "Nature's medicines, hand-crafted.", "none", 1, True, ["buy_potions", "heal_minor"]),
    "bicycle":      GameLocation("waypoint",        "🚲", "corridor",
        "Swift travel for those who know the paths.", "none", 0, True, []),
    "jewelry":      GameLocation("merchant_guild",  "💎", "treasure",
        "Fine adornments that hold magical properties.", "none", 2, True, ["buy_items"]),
    "gift":         GameLocation("general_store",   "🎁", "corridor",
        "Curiosities and sundries of uncertain provenance.", "none", 1, True, ["buy_items"]),
    "sports":       GameLocation("training_hall",   "⚔️", "chamber",
        "Equipment for the body's improvement. The serious practitioner knows this place.",
        "rival", 1, False, ["train_str", "train_dex"]),
    "outdoor":      GameLocation("grove",           "🌿", "corridor",
        "The wilderness packaged for urban consumption. Still carries the scent of the wild.",
        "none", 1, True, ["ranger_skills"]),
    "pharmacy":     GameLocation("healer_shrine",   "💊", "corridor",
        "Modern alchemy. Potions by another name.", "none", 1, True, ["heal_minor", "buy_potions"]),
    "optician":     GameLocation("mage_tower",      "👁️", "corridor",
        "Clarity of sight is clarity of mind.", "none", 0, True, ["gain_int"]),
    "electronics":  GameLocation("mage_tower",      "⚡", "corridor",
        "Arcane devices of the modern age. The uninitiated call it technology.",
        "none", 1, True, ["gain_int"]),
    "department_store": GameLocation("merchant_guild", "🏬", "treasure",
        "A vast marketplace under one roof. The merchant guild writ large.",
        "none", 2, True, ["buy_items", "buy_potions"]),
}


# ── Classification entry point ────────────────────────────────────────────────

def classify_poi(tags: dict) -> Optional[GameLocation]:
    """
    Classify an OSM POI by its tags.
    Returns a GameLocation or None if the POI cannot be classified.
    Priority: amenity → leisure → tourism → historic → shop
    """
    amenity = tags.get("amenity", "")
    leisure = tags.get("leisure", "")
    tourism = tags.get("tourism", "")
    historic = tags.get("historic", "")
    shop = tags.get("shop", "")

    if amenity and amenity in AMENITY_MAP:
        return AMENITY_MAP[amenity]
    if leisure and leisure in LEISURE_MAP:
        return LEISURE_MAP[leisure]
    if tourism and tourism in TOURISM_MAP:
        return TOURISM_MAP[tourism]
    if historic and historic in HISTORIC_MAP:
        return HISTORIC_MAP[historic]
    if shop and shop in SHOP_MAP:
        return SHOP_MAP[shop]

    # Generic fallback: any tagged POI gets a mystery slot
    if amenity or leisure or tourism or historic or shop:
        return GameLocation(
            "mystery", "❓", "corridor",
            "The purpose of this place is unclear, yet its presence in the game world is undeniable.",
            "random", 1, False, []
        )
    return None


# ── Geo helpers ────────────────────────────────────────────────────────────────

def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Straight-line distance in metres between two GPS coordinates."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def process_overpass_elements(
    elements: list[dict],
    player_lat: float,
    player_lng: float,
    max_results: int = 20,
) -> list[dict]:
    """
    Turn raw Overpass API elements into classified game POI dicts,
    sorted by distance from the player.
    """
    seen_osm_ids: set[str] = set()
    pois: list[dict] = []

    for el in elements:
        tags = el.get("tags", {})
        name = tags.get("name", "").strip()
        if not name:
            continue  # unnamed POIs are useless for the game

        # Get coordinates (node vs way-with-center)
        if el.get("type") == "node":
            lat = el.get("lat")
            lon = el.get("lon")
        else:
            center = el.get("center", {})
            lat = center.get("lat")
            lon = center.get("lon")

        if lat is None or lon is None:
            continue

        osm_id = f"{el.get('type', 'n')}{el.get('id', '')}"
        if osm_id in seen_osm_ids:
            continue
        seen_osm_ids.add(osm_id)

        game_loc = classify_poi(tags)
        if not game_loc:
            continue

        dist = haversine_m(player_lat, player_lng, lat, lon)

        pois.append({
            "name": name,
            "lat": lat,
            "lng": lon,
            "osm_id": osm_id,
            "game_role": game_loc.game_role,
            "emoji": game_loc.emoji,
            "room_type": game_loc.room_type,
            "description": game_loc.description,
            "enemy_theme": game_loc.enemy_theme,
            "loot_tier": game_loc.loot_tier,
            "is_safe": game_loc.is_safe,
            "services": game_loc.services,
            "distance_m": round(dist),
        })

    pois.sort(key=lambda p: p["distance_m"])
    return pois[:max_results]
