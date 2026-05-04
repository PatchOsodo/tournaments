#!/bin/bash
# =============================================================================
# bundle.sh — Basketball Tournament Manager
# Creates two distributable packages:
#   1. basketball-tournament-app-DATE.zip   (clean, no database)
#   2. basketball-tournament-backup-DATE.zip (your live data)
# =============================================================================

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
DATE=$(date +%Y%m%d-%H%M)

# ── Colours ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${BOLD}============================================${NC}"
echo -e "${BOLD} Basketball Tournament Manager — Bundle${NC}"
echo -e "${BOLD}============================================${NC}"

# ── Step 1: Clean up known junk files before bundling ────────────────────────
echo ""
echo -e "${BLUE}[prep]${NC} Cleaning up temporary files..."

rm -f pb_public/assets/css/styless.css          2>/dev/null || true
rm -f "pb_public/assets/js/main (Copy).js"       2>/dev/null || true
rm -f pb_public/assets/js/main2.js               2>/dev/null || true
rm -f pb_public/assets/js/main.js.tar.gz         2>/dev/null || true
rm -f nohup.out                                   2>/dev/null || true

echo -e "  ${GREEN}✓${NC} Done"

# ── Step 2: Generate a README for first-time recipients ───────────────────────
echo ""
echo -e "${BLUE}[prep]${NC} Writing FIRST-RUN-README.txt..."

cat > FIRST-RUN-README.txt << 'READMEEOF'
Basketball Tournament Manager
==============================

QUICK START (3 steps)
---------------------

1. Make scripts executable (Linux / Mac only — skip on Windows):

     chmod +x pocketbase start.sh stop.sh setup-collections.sh

2. Start PocketBase (keep this terminal open):

     ./start.sh

   On Windows:
     Double-click START.bat

3. In a NEW terminal, run the one-time setup:

     ./setup-collections.sh

   This creates your admin account and all database collections
   automatically. You only need to do this ONCE.

4. Open the app:

     http://127.0.0.1:8090

That is it. The setup script handles everything else.


DAILY USE
---------
Start:   ./start.sh      (or double-click START.bat on Windows)
Stop:    ./stop.sh       (or close the terminal window)
App:     http://127.0.0.1:8090
Admin:   http://127.0.0.1:8090/_/


BACKUP YOUR DATA
----------------
Your tournament data lives in:   pb_data/data.db

To back it up:
  cp pb_data/data.db ~/backups/tournament-$(date +%Y%m%d).db

To restore:
  1. Stop PocketBase (./stop.sh)
  2. cp your-backup.db pb_data/data.db
  3. Start PocketBase (./start.sh)


MOVING TO ANOTHER MACHINE
--------------------------
Copy the entire basketball-tournament/ folder to the new machine.
Run setup-collections.sh once on the new machine.
Your data goes with it inside pb_data/.


REQUIREMENTS
------------
- Linux, Mac, or Windows
- A modern web browser (Firefox, Chrome, Edge)
- No internet connection required after first setup

READMEEOF

echo -e "  ${GREEN}✓${NC} FIRST-RUN-README.txt written"

# ── Step 3: Generate START.bat for Windows recipients ─────────────────────────
echo ""
echo -e "${BLUE}[prep]${NC} Writing START.bat (Windows launcher)..."

cat > START.bat << 'BATEOF'
@echo off
title Basketball Tournament Manager
echo.
echo  Basketball Tournament Manager
echo  ==============================
echo.
echo  Starting PocketBase...
echo  The app will open in your browser automatically.
echo.
echo  To stop: close this window or press Ctrl+C
echo.

:: Open browser after a short delay
start "" timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:8090

:: Start PocketBase
pocketbase.exe serve

pause
BATEOF

echo -e "  ${GREEN}✓${NC} START.bat written"

# ── Step 4: Build the distributable app package (no database) ─────────────────
echo ""
echo -e "${BLUE}[1/2]${NC} Building distributable app package..."

APP_ZIP="basketball-tournament-app-${DATE}.zip"

# Files to include in the distributable
zip -r "$APP_ZIP" \
  pocketbase \
  start.sh \
  stop.sh \
  START.bat \
  setup-collections.sh \
  FIRST-RUN-README.txt \
  pb_public/ \
  pb_migrations/ \
  --exclude "*.tar.gz" \
  --exclude "**/.DS_Store" \
  --exclude "**/Thumbs.db" \
  --exclude "**/__pycache__/*" \
  --exclude "pb_public/assets/css/styless.css" \
  --exclude "pb_public/assets/js/main2.js" \
  --exclude "pb_public/assets/js/main (Copy).js" \
  2>/dev/null

echo -e "  ${GREEN}✓${NC} $APP_ZIP  ($(du -sh "$APP_ZIP" | cut -f1))"

# ── Step 5: Build the full backup (includes live database) ────────────────────
echo ""
echo -e "${BLUE}[2/2]${NC} Building full backup (includes your live data)..."

BACKUP_ZIP="basketball-tournament-backup-${DATE}.zip"

zip -r "$BACKUP_ZIP" \
  pocketbase \
  start.sh \
  stop.sh \
  START.bat \
  setup-collections.sh \
  FIRST-RUN-README.txt \
  pb_public/ \
  pb_migrations/ \
  pb_data/ \
  --exclude "*.tar.gz" \
  --exclude "**/.DS_Store" \
  --exclude "**/Thumbs.db" \
  2>/dev/null

echo -e "  ${GREEN}✓${NC} $BACKUP_ZIP  ($(du -sh "$BACKUP_ZIP" | cut -f1))"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}============================================${NC}"
echo -e "${GREEN}${BOLD} Done!${NC}"
echo ""
echo -e " ${BOLD}Distributable${NC} → $APP_ZIP"
echo "   Share this with others."
echo "   No database included — recipients run setup-collections.sh once."
echo ""
echo -e " ${BOLD}Backup${NC}        → $BACKUP_ZIP"
echo "   Keep this private — contains your live tournament data."
echo "   Restore by extracting anywhere and running ./start.sh"
echo -e "${BOLD}============================================${NC}"
echo ""
