#!/bin/bash
# Manual Testing Setup Script
# Run this from your target project directory to set up test fixtures

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURES_DIR="$SCRIPT_DIR/fixtures"

echo "=== Manual Testing Setup ==="
echo ""

# Check if we're in the right place
if [ ! -f "opencode.json" ] && [ ! -f "package.json" ]; then
    echo "Warning: No opencode.json or package.json found."
    echo "Run this from your project root directory."
    echo ""
fi

# Create directories
echo "1. Creating directories..."
mkdir -p thoughts/ledgers
mkdir -p thoughts/shared/handoffs
mkdir -p thoughts/shared/plans

# Copy fixtures
echo "2. Copying test fixtures..."
cp "$FIXTURES_DIR/thoughts/ledgers/CONTINUITY_test-session.md" thoughts/ledgers/
cp "$FIXTURES_DIR/thoughts/shared/handoffs/2024-12-28_15-30-00_oauth-setup.md" thoughts/shared/handoffs/
cp "$FIXTURES_DIR/thoughts/shared/plans/2024-12-27-oauth-implementation.md" thoughts/shared/plans/

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Test fixtures created:"
echo "  - thoughts/ledgers/CONTINUITY_test-session.md"
echo "  - thoughts/shared/handoffs/2024-12-28_15-30-00_oauth-setup.md"
echo "  - thoughts/shared/plans/2024-12-27-oauth-implementation.md"
echo ""
echo "Now you can test:"
echo "  1. Start opencode - ledger should be injected automatically"
echo "  2. Run /ledger - should update existing ledger"
echo "  3. Run /search oauth - should find handoff and plan"
echo "  4. Run /search JWT tokens - should find relevant results"
echo ""
