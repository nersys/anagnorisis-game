#!/usr/bin/env python3
"""
Quick test to verify the project is set up correctly.
Run this to check imports and basic functionality.
"""

import sys
import asyncio

def test_imports():
    """Test that all modules can be imported."""
    print("Testing imports...")
    
    try:
        from shared.models import Player, Party, Adventure, GameMessage, MessageType
        print("  ✓ shared.models")
    except ImportError as e:
        print(f"  ✗ shared.models: {e}")
        return False
    
    try:
        from shared.constants import CLASS_BASE_STATS, LOGO
        print("  ✓ shared.constants")
    except ImportError as e:
        print(f"  ✗ shared.constants: {e}")
        return False
    
    try:
        from server.connection_manager import ConnectionManager
        print("  ✓ server.connection_manager")
    except ImportError as e:
        print(f"  ✗ server.connection_manager: {e}")
        return False
    
    try:
        from server.game_engine import GameEngine
        print("  ✓ server.game_engine")
    except ImportError as e:
        print(f"  ✗ server.game_engine: {e}")
        return False
    
    try:
        from server.ai_dungeon_master import AIDungeonMaster
        print("  ✓ server.ai_dungeon_master")
    except ImportError as e:
        print(f"  ✗ server.ai_dungeon_master: {e}")
        return False
    
    print("\nAll imports successful!")
    return True


def test_models():
    """Test creating model instances."""
    print("\nTesting models...")
    
    from shared.models import Player, PlayerClass, PlayerStats, Party, Adventure
    
    # Create a player
    player = Player(
        name="Test Hero",
        player_class=PlayerClass.WARRIOR,
    )
    print(f"  ✓ Created player: {player.name} ({player.player_class.value})")
    
    # Create a party
    party = Party(
        name="Test Party",
        leader_id=player.id,
        member_ids=[player.id],
    )
    print(f"  ✓ Created party: {party.name} (id: {party.id})")
    
    # Create an adventure
    adventure = Adventure(
        name="Test Adventure",
        description="A test adventure",
        party_id=party.id,
    )
    print(f"  ✓ Created adventure: {adventure.name}")
    
    print("\nAll models working!")
    return True


async def test_game_engine():
    """Test the game engine initialization."""
    print("\nTesting game engine...")
    
    from server.game_engine import GameEngine
    
    engine = GameEngine()
    await engine.initialize()
    print("  ✓ Game engine initialized")
    
    await engine.shutdown()
    print("  ✓ Game engine shutdown")
    
    print("\nGame engine working!")
    return True


def main():
    """Run all tests."""
    print("=" * 50)
    print("ANAGNORISIS - Setup Verification")
    print("=" * 50)
    
    all_passed = True
    
    if not test_imports():
        all_passed = False
    
    if not test_models():
        all_passed = False
    
    # Run async tests
    if not asyncio.run(test_game_engine()):
        all_passed = False
    
    print("\n" + "=" * 50)
    if all_passed:
        print("✅ All tests passed! The project is ready.")
        print("\nNext steps:")
        print("1. Copy .env.example to .env")
        print("2. Add your ANTHROPIC_API_KEY to .env")
        print("3. Run: docker-compose up --build")
    else:
        print("❌ Some tests failed. Check the errors above.")
    print("=" * 50)
    
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
