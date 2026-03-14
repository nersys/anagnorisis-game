# Anagnorisis Makefile
# Common commands for development

.PHONY: help setup run-server run-client test clean docker-up docker-down

help:
	@echo "Anagnorisis Development Commands"
	@echo "================================="
	@echo ""
	@echo "Setup:"
	@echo "  make setup        - Create venv and install dependencies"
	@echo ""
	@echo "Local Development:"
	@echo "  make run-server   - Start the game server"
	@echo "  make run-client   - Start the TUI client"
	@echo "  make test         - Run the test script"
	@echo ""
	@echo "Docker:"
	@echo "  make docker-up    - Build and start all services"
	@echo "  make docker-down  - Stop all services"
	@echo "  make docker-logs  - View server logs"
	@echo ""
	@echo "Cleanup:"
	@echo "  make clean        - Remove cache files and database"

# ============================================
# Setup
# ============================================

setup:
	@echo "Creating virtual environment..."
	python3 -m venv .venv
	@echo "Installing dependencies..."
	.venv/bin/pip install --upgrade pip
	.venv/bin/pip install -e ".[dev]"
	@echo ""
	@echo "Setup complete! Run:"
	@echo "  source .venv/bin/activate"
	@echo "  cp .env.example .env"
	@echo "  # Edit .env with your API key"

# ============================================
# Local Development
# ============================================

run-server:
	@echo "Starting server..."
	python -m server.main

run-client:
	@echo "Starting client..."
	python -m client.main

test:
	python test_setup.py

# ============================================
# Docker
# ============================================

docker-up:
	docker-compose up --build

docker-down:
	docker-compose down

docker-logs:
	docker-compose logs -f server

docker-client:
	docker-compose run --rm client

# ============================================
# Cleanup
# ============================================

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
	rm -f data/*.db 2>/dev/null || true
	@echo "Cleaned up cache files and database"
