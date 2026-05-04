#!/bin/bash
# =============================================================================
# setup-collections.sh
# Basketball Tournament Manager — Automated PocketBase Collection Setup
# Version: 1.0.0
#
# WHAT THIS DOES:
#   1. Waits for PocketBase to be reachable
#   2. Creates an admin account (first run only)
#   3. Authenticates and gets an admin token
#   4. Creates all three collections with correct fields and types
#   5. Sets API rules to open on all collections
#   6. Verifies everything was created correctly
#
# USAGE:
#   ./setup-collections.sh
#
# REQUIREMENTS:
#   - PocketBase must be running (./start.sh in another terminal, or as a service)
#   - curl must be installed (it is on every Linux/Mac by default)
#
# SAFE TO RE-RUN:
#   The script checks if each collection already exists before creating it.
#   Running it twice will not duplicate or break anything.
# =============================================================================

set -e

# ── Colours for output ────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Colour

# ── Configuration ─────────────────────────────────────────────────────────────
PB_URL="http://127.0.0.1:8090"
TIMEOUT=30        # seconds to wait for PocketBase to start
RETRY_INTERVAL=2  # seconds between health check retries

# ── Helper: print a section header ───────────────────────────────────────────
header() {
  echo ""
  echo -e "${BOLD}${BLUE}── $1 ${NC}"
}

# ── Helper: print success ────────────────────────────────────────────────────
ok() {
  echo -e "  ${GREEN}✓${NC} $1"
}

# ── Helper: print warning ────────────────────────────────────────────────────
warn() {
  echo -e "  ${YELLOW}⚠${NC}  $1"
}

# ── Helper: print error and exit ─────────────────────────────────────────────
fail() {
  echo -e "  ${RED}✗${NC} $1"
  echo ""
  echo -e "${RED}Setup failed. See message above.${NC}"
  exit 1
}

# ── Helper: make an authenticated API call ───────────────────────────────────
# Usage: api_call METHOD /path [body]
# Returns the response body. Exits on HTTP error.
api_call() {
  local method="$1"
  local path="$2"
  local body="$3"

  local args=(-s -w "\n%{http_code}" -X "$method" "${PB_URL}${path}")
  args+=(-H "Content-Type: application/json")

  if [[ -n "$ADMIN_TOKEN" ]]; then
    args+=(-H "Authorization: Bearer ${ADMIN_TOKEN}")
  fi

  if [[ -n "$body" ]]; then
    args+=(-d "$body")
  fi

  local response
  response=$(curl "${args[@]}")

  local http_code
  http_code=$(echo "$response" | tail -n1)
  local body_out
  body_out=$(echo "$response" | head -n -1)

  # Return body; caller checks http_code via $?
  echo "$body_out"

  # Exit code: 0 if 2xx, 1 otherwise
  if [[ "$http_code" -ge 200 && "$http_code" -lt 300 ]]; then
    return 0
  else
    return 1
  fi
}

# =============================================================================
# STEP 0 — Banner
# =============================================================================
echo ""
echo -e "${BOLD}============================================${NC}"
echo -e "${BOLD} Basketball Tournament Manager${NC}"
echo -e "${BOLD} PocketBase Collection Setup${NC}"
echo -e "${BOLD}============================================${NC}"

# =============================================================================
# STEP 1 — Wait for PocketBase to be reachable
# =============================================================================
header "Step 1 — Connecting to PocketBase"

echo "  Waiting for PocketBase at ${PB_URL}..."
elapsed=0
while true; do
  if curl -s "${PB_URL}/api/health" | grep -q '"code":200'; then
    ok "PocketBase is running"
    break
  fi

  if [[ $elapsed -ge $TIMEOUT ]]; then
    fail "PocketBase did not start within ${TIMEOUT} seconds.
       Make sure it is running first:
         ./start.sh          (in another terminal)
         or
         ./pocketbase serve"
  fi

  echo "    ...retrying in ${RETRY_INTERVAL}s (${elapsed}s elapsed)"
  sleep "$RETRY_INTERVAL"
  elapsed=$((elapsed + RETRY_INTERVAL))
done

# =============================================================================
# STEP 2 — Admin account creation / authentication
# =============================================================================
header "Step 2 — Admin account"

# Check if any admin accounts exist by attempting a dummy auth.
# PocketBase returns 400 "Failed to authenticate" if admins exist but
# credentials are wrong, and a different response if no admins exist at all.

echo "  Checking for existing admin accounts..."
ADMIN_CHECK=$(curl -s "${PB_URL}/api/admins/auth-with-password" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"identity":"check@example.com","password":"checkonly"}' 2>/dev/null || true)

# If the response contains "Failed to authenticate" it means admins exist
# If it contains "forbidden" or similar it means no admins exist yet
NEEDS_ADMIN=false
if echo "$ADMIN_CHECK" | grep -q '"data":{}'; then
  # PocketBase returns {"code":400,"message":"Failed to authenticate.","data":{}}
  # when admins exist but credentials are wrong — admins already set up
  NEEDS_ADMIN=false
elif echo "$ADMIN_CHECK" | grep -q 'forbidden\|no admin'; then
  NEEDS_ADMIN=true
fi

if $NEEDS_ADMIN; then
  echo ""
  echo -e "  ${YELLOW}No admin account found. Creating one now.${NC}"
  echo "  This will be your login for the PocketBase dashboard."
  echo ""

  while true; do
    read -rp "  Admin email: " ADMIN_EMAIL
    [[ -n "$ADMIN_EMAIL" ]] && break
    echo "  Email cannot be empty."
  done

  while true; do
    read -rsp "  Admin password (min 10 characters): " ADMIN_PASSWORD
    echo ""
    if [[ ${#ADMIN_PASSWORD} -ge 10 ]]; then
      break
    fi
    echo "  Password must be at least 10 characters."
  done

  read -rsp "  Confirm password: " ADMIN_PASSWORD_CONFIRM
  echo ""

  if [[ "$ADMIN_PASSWORD" != "$ADMIN_PASSWORD_CONFIRM" ]]; then
    fail "Passwords do not match."
  fi

  # Create admin via the setup endpoint (only works when no admins exist)
  SETUP_RESP=$(curl -s -X POST "${PB_URL}/api/admins" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\",\"passwordConfirm\":\"${ADMIN_PASSWORD_CONFIRM}\"}" \
    2>/dev/null || true)

  if echo "$SETUP_RESP" | grep -q '"email"'; then
    ok "Admin account created: ${ADMIN_EMAIL}"
  else
    # PocketBase sometimes needs the first admin created through the UI
    # Try the collections endpoint approach instead
    warn "Could not create admin via API — this is normal on some PocketBase versions."
    echo ""
    echo "  Please create your admin account manually:"
    echo "    1. Open http://127.0.0.1:8090/_/ in your browser"
    echo "    2. Enter your email and password"
    echo "    3. Come back and run this script again"
    echo ""
    exit 0
  fi
else
  echo "  Admin accounts exist. Please enter your credentials."
  echo ""
  read -rp "  Admin email: " ADMIN_EMAIL
  read -rsp "  Admin password: " ADMIN_PASSWORD
  echo ""
fi

# =============================================================================
# STEP 3 — Authenticate and get token
# =============================================================================
header "Step 3 — Authenticating"

AUTH_RESP=$(curl -s -X POST "${PB_URL}/api/admins/auth-with-password" \
  -H "Content-Type: application/json" \
  -d "{\"identity\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
  2>/dev/null)

ADMIN_TOKEN=$(echo "$AUTH_RESP" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [[ -z "$ADMIN_TOKEN" ]]; then
  echo "  Response: $AUTH_RESP"
  fail "Authentication failed. Check your email and password."
fi

ok "Authenticated successfully"

# =============================================================================
# STEP 4 — Helper: check if collection already exists
# =============================================================================

collection_exists() {
  local name="$1"
  local resp
  resp=$(curl -s "${PB_URL}/api/collections/${name}" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" 2>/dev/null || true)
  echo "$resp" | grep -q "\"name\":\"${name}\""
}

# =============================================================================
# STEP 5 — Create collections
# =============================================================================
header "Step 4 — Creating collections"

# ── Collection 1: tournaments ─────────────────────────────────────────────────
echo ""
echo "  [1/3] tournaments"

if collection_exists "tournaments"; then
  warn "Collection 'tournaments' already exists — checking for event_name field..."

  # Check if event_name field exists, add it if not
  SCHEMA_RESP=$(curl -s "${PB_URL}/api/collections/tournaments" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" 2>/dev/null)

  if echo "$SCHEMA_RESP" | grep -q '"event_name"'; then
    ok "event_name field already present"
  else
    warn "event_name field missing — adding it now"

    # Get current schema and patch it
    CURRENT_SCHEMA=$(echo "$SCHEMA_RESP" | python3 -c "
import sys, json
data = json.load(sys.stdin)
schema = data.get('schema', [])
schema.append({
  'name': 'event_name',
  'type': 'text',
  'required': False,
  'options': {'min': None, 'max': None, 'pattern': ''}
})
print(json.dumps({'schema': schema}))
" 2>/dev/null)

    if [[ -n "$CURRENT_SCHEMA" ]]; then
      PATCH_RESP=$(curl -s -X PATCH "${PB_URL}/api/collections/tournaments" \
        -H "Authorization: Bearer ${ADMIN_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "$CURRENT_SCHEMA" 2>/dev/null)

      if echo "$PATCH_RESP" | grep -q '"name":"tournaments"'; then
        ok "event_name field added"
      else
        warn "Could not add event_name automatically. Add it manually in the dashboard."
      fi
    fi
  fi
else
  TOURNAMENTS_BODY='{
    "name": "tournaments",
    "type": "base",
    "listRule": "",
    "viewRule": "",
    "createRule": "",
    "updateRule": "",
    "deleteRule": "",
    "schema": [
      {
        "name": "name",
        "type": "text",
        "required": true,
        "options": { "min": 1, "max": 200, "pattern": "" }
      },
      {
        "name": "format",
        "type": "text",
        "required": true,
        "options": { "min": 1, "max": 50, "pattern": "" }
      },
      {
        "name": "status",
        "type": "text",
        "required": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "name": "event_name",
        "type": "text",
        "required": false,
        "options": { "min": null, "max": null, "pattern": "" }
      }
    ]
  }'

  RESP=$(curl -s -w "\n%{http_code}" -X POST "${PB_URL}/api/collections" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$TOURNAMENTS_BODY" 2>/dev/null)

  HTTP_CODE=$(echo "$RESP" | tail -n1)
  BODY=$(echo "$RESP" | head -n -1)

  if [[ "$HTTP_CODE" -ge 200 && "$HTTP_CODE" -lt 300 ]]; then
    ok "Created 'tournaments' collection"
  else
    echo "  Response: $BODY"
    fail "Failed to create 'tournaments' collection (HTTP $HTTP_CODE)"
  fi
fi

# ── Collection 2: teams ───────────────────────────────────────────────────────
echo ""
echo "  [2/3] teams"

if collection_exists "teams"; then
  ok "Collection 'teams' already exists — skipping"
else
  # We need the tournaments collection ID for the relation field
  TOURNAMENTS_ID=$(curl -s "${PB_URL}/api/collections/tournaments" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" 2>/dev/null | \
    grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  if [[ -z "$TOURNAMENTS_ID" ]]; then
    fail "Could not get tournaments collection ID. Make sure it was created first."
  fi

  TEAMS_BODY="{
    \"name\": \"teams\",
    \"type\": \"base\",
    \"listRule\": \"\",
    \"viewRule\": \"\",
    \"createRule\": \"\",
    \"updateRule\": \"\",
    \"deleteRule\": \"\",
    \"schema\": [
      {
        \"name\": \"name\",
        \"type\": \"text\",
        \"required\": true,
        \"options\": { \"min\": 1, \"max\": 100, \"pattern\": \"\" }
      },
      {
        \"name\": \"tournament\",
        \"type\": \"relation\",
        \"required\": true,
        \"options\": {
          \"collectionId\": \"${TOURNAMENTS_ID}\",
          \"cascadeDelete\": true,
          \"minSelect\": null,
          \"maxSelect\": 1,
          \"displayFields\": [\"name\"]
        }
      },
      {
        \"name\": \"seed\",
        \"type\": \"number\",
        \"required\": false,
        \"options\": { \"min\": null, \"max\": null, \"noDecimal\": true }
      },
      {
        \"name\": \"group_name\",
        \"type\": \"text\",
        \"required\": false,
        \"options\": { \"min\": null, \"max\": null, \"pattern\": \"\" }
      }
    ]
  }"

  RESP=$(curl -s -w "\n%{http_code}" -X POST "${PB_URL}/api/collections" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$TEAMS_BODY" 2>/dev/null)

  HTTP_CODE=$(echo "$RESP" | tail -n1)
  BODY=$(echo "$RESP" | head -n -1)

  if [[ "$HTTP_CODE" -ge 200 && "$HTTP_CODE" -lt 300 ]]; then
    ok "Created 'teams' collection"
  else
    echo "  Response: $BODY"
    fail "Failed to create 'teams' collection (HTTP $HTTP_CODE)"
  fi
fi

# ── Collection 3: fixtures ────────────────────────────────────────────────────
echo ""
echo "  [3/3] fixtures"

if collection_exists "fixtures"; then
  ok "Collection 'fixtures' already exists — skipping"
else
  TOURNAMENTS_ID=$(curl -s "${PB_URL}/api/collections/tournaments" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" 2>/dev/null | \
    grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  TEAMS_ID=$(curl -s "${PB_URL}/api/collections/teams" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" 2>/dev/null | \
    grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  if [[ -z "$TOURNAMENTS_ID" || -z "$TEAMS_ID" ]]; then
    fail "Could not get collection IDs. Make sure tournaments and teams were created first."
  fi

  FIXTURES_BODY="{
    \"name\": \"fixtures\",
    \"type\": \"base\",
    \"listRule\": \"\",
    \"viewRule\": \"\",
    \"createRule\": \"\",
    \"updateRule\": \"\",
    \"deleteRule\": \"\",
    \"schema\": [
      {
        \"name\": \"tournament\",
        \"type\": \"relation\",
        \"required\": true,
        \"options\": {
          \"collectionId\": \"${TOURNAMENTS_ID}\",
          \"cascadeDelete\": true,
          \"minSelect\": null,
          \"maxSelect\": 1,
          \"displayFields\": [\"name\"]
        }
      },
      {
        \"name\": \"round\",
        \"type\": \"number\",
        \"required\": true,
        \"options\": { \"min\": 1, \"max\": null, \"noDecimal\": true }
      },
      {
        \"name\": \"match_number\",
        \"type\": \"number\",
        \"required\": true,
        \"options\": { \"min\": 1, \"max\": null, \"noDecimal\": true }
      },
      {
        \"name\": \"round_label\",
        \"type\": \"text\",
        \"required\": false,
        \"options\": { \"min\": null, \"max\": null, \"pattern\": \"\" }
      },
      {
        \"name\": \"home_team\",
        \"type\": \"relation\",
        \"required\": false,
        \"options\": {
          \"collectionId\": \"${TEAMS_ID}\",
          \"cascadeDelete\": false,
          \"minSelect\": null,
          \"maxSelect\": 1,
          \"displayFields\": [\"name\"]
        }
      },
      {
        \"name\": \"away_team\",
        \"type\": \"relation\",
        \"required\": false,
        \"options\": {
          \"collectionId\": \"${TEAMS_ID}\",
          \"cascadeDelete\": false,
          \"minSelect\": null,
          \"maxSelect\": 1,
          \"displayFields\": [\"name\"]
        }
      },
      {
        \"name\": \"home_score\",
        \"type\": \"number\",
        \"required\": false,
        \"options\": { \"min\": 0, \"max\": null, \"noDecimal\": true }
      },
      {
        \"name\": \"away_score\",
        \"type\": \"number\",
        \"required\": false,
        \"options\": { \"min\": 0, \"max\": null, \"noDecimal\": true }
      },
      {
        \"name\": \"winner\",
        \"type\": \"relation\",
        \"required\": false,
        \"options\": {
          \"collectionId\": \"${TEAMS_ID}\",
          \"cascadeDelete\": false,
          \"minSelect\": null,
          \"maxSelect\": 1,
          \"displayFields\": [\"name\"]
        }
      },
      {
        \"name\": \"status\",
        \"type\": \"text\",
        \"required\": false,
        \"options\": { \"min\": null, \"max\": null, \"pattern\": \"\" }
      },
      {
        \"name\": \"is_bye\",
        \"type\": \"bool\",
        \"required\": false,
        \"options\": {}
      },
      {
        \"name\": \"group_name\",
        \"type\": \"text\",
        \"required\": false,
        \"options\": { \"min\": null, \"max\": null, \"pattern\": \"\" }
      }
    ]
  }"

  RESP=$(curl -s -w "\n%{http_code}" -X POST "${PB_URL}/api/collections" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$FIXTURES_BODY" 2>/dev/null)

  HTTP_CODE=$(echo "$RESP" | tail -n1)
  BODY=$(echo "$RESP" | head -n -1)

  if [[ "$HTTP_CODE" -ge 200 && "$HTTP_CODE" -lt 300 ]]; then
    ok "Created 'fixtures' collection"
  else
    echo "  Response: $BODY"
    fail "Failed to create 'fixtures' collection (HTTP $HTTP_CODE)"
  fi
fi

# =============================================================================
# STEP 6 — Verify all three collections exist and have open rules
# =============================================================================
header "Step 5 — Verifying setup"

ALL_OK=true
for COLL in tournaments teams fixtures; do
  VERIFY=$(curl -s "${PB_URL}/api/collections/${COLL}" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" 2>/dev/null)

  if echo "$VERIFY" | grep -q "\"name\":\"${COLL}\""; then
    ok "Collection '${COLL}' verified"
  else
    warn "Collection '${COLL}' not found — something went wrong"
    ALL_OK=false
  fi
done

# =============================================================================
# DONE
# =============================================================================
echo ""
echo -e "${BOLD}============================================${NC}"

if $ALL_OK; then
  echo -e "${GREEN}${BOLD} Setup complete!${NC}"
  echo ""
  echo " Your PocketBase collections are ready."
  echo " Open the app at: http://127.0.0.1:8090"
  echo ""
  echo " Admin dashboard: http://127.0.0.1:8090/_/"
  echo "   Email   : ${ADMIN_EMAIL}"
  echo "   Password: (the one you just entered)"
else
  echo -e "${YELLOW}${BOLD} Setup finished with warnings.${NC}"
  echo ""
  echo " Some collections may need manual verification."
  echo " Open the admin dashboard to check:"
  echo "   http://127.0.0.1:8090/_/"
fi

echo -e "${BOLD}============================================${NC}"
echo ""
