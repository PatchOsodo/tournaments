# Basketball Tournament Manager
## Local Setup Guide

### Overview
A self-hosted basketball tournament management application built with vanilla
HTML/CSS/JS and PocketBase as the backend database. No cloud dependencies,
no npm, no build tools. Everything runs from a single binary and one HTML file.

---

## Prerequisites
- A Linux machine (this guide targets Fedora)
- Internet access for the initial download only
- A modern browser (Firefox, Chrome, Edge)

---

## Folder Structure (after setup)
```
basketball-tournament/
├── pocketbase                  ← PocketBase binary
├── pb_data/                    ← Auto-created. Holds your SQLite database
│   └── data.db                 ← Your actual tournament data lives here
├── pb_public/                  ← Static files served by PocketBase
│   ├── index.html              ← The tournament app
│   └── pocketbase.umd.js       ← PocketBase JS SDK (local copy)
├── README.md                   ← This file
└── COLLECTIONS.md              ← Database schema reference
```

---

## Step 1 — Download PocketBase

```bash
cd ~/basketball-tournament

# Download the latest Linux AMD64 binary
wget https://github.com/pocketbase/pocketbase/releases/latest/download/pocketbase_linux_amd64.zip

# Unzip and clean up
unzip pocketbase_linux_amd64.zip
chmod +x pocketbase
rm pocketbase_linux_amd64.zip

# Verify
./pocketbase --version
```

---

## Step 2 — First Run and Admin Setup

```bash
./pocketbase serve
```

Expected output:
```
Server started at http://127.0.0.1:8090
  ➜ REST API: http://127.0.0.1:8090/api/
  ➜ Admin UI: http://127.0.0.1:8090/_/
```

1. Open http://127.0.0.1:8090/_/ in your browser
2. Create your admin email and password
3. Keep the terminal open (or set up the systemd service in Step 5)

---

## Step 3 — Download the JS SDK

```bash
cd ~/basketball-tournament/pb_public

wget https://github.com/pocketbase/js-sdk/releases/download/v0.21.3/pocketbase.umd.js
```

If the file is not found, visit https://github.com/pocketbase/js-sdk/releases
and download the latest `pocketbase.umd.js` file manually into pb_public/.

---

## Step 4 — Create Database Collections

Log in to the admin UI at http://127.0.0.1:8090/_/ and create the following
collections. See COLLECTIONS.md for the full field reference.

### Quick Summary
| Collection    | Purpose                              |
|---------------|--------------------------------------|
| tournaments   | One record per tournament            |
| teams         | Teams belonging to a tournament      |
| fixtures      | Individual matches within a tournament|

### How to create a collection
1. Click "New collection" in the left sidebar
2. Set type to "Base collection"
3. Add fields as listed in COLLECTIONS.md
4. Save

### API Rules (do this for every collection)
1. Click the collection → API Rules tab
2. Set ALL rules (List, View, Create, Update, Delete) to empty/blank
3. Save
   This disables authentication for local development. Lock it down
   before exposing to the internet.

---

## Step 5 — Auto-start PocketBase on Login (Optional)

Create a systemd user service so PocketBase starts automatically:

```bash
mkdir -p ~/.config/systemd/user

cat > ~/.config/systemd/user/pocketbase.service << EOF
[Unit]
Description=PocketBase Tournament Server
After=network.target

[Service]
ExecStart=/home/$USER/basketball-tournament/pocketbase serve
WorkingDirectory=/home/$USER/basketball-tournament
Restart=on-failure

[Install]
WantedBy=default.target
EOF

systemctl --user enable pocketbase
systemctl --user start pocketbase
systemctl --user status pocketbase
```

To stop it:
```bash
systemctl --user stop pocketbase
```

To view logs:
```bash
journalctl --user -u pocketbase -f
```

---

## Step 6 — Open the App

With PocketBase running, open your browser and go to:

```
http://127.0.0.1:8090
```

PocketBase automatically serves the contents of pb_public/ at the root URL.
The tournament app loads instantly with no additional configuration.

---

## Backup

Your entire database is a single SQLite file:
```bash
cp ~/basketball-tournament/pb_data/data.db ~/backups/data-$(date +%Y%m%d).db
```

Back this file up regularly. Restoring is as simple as replacing it.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Port 8090 already in use | `./pocketbase serve --http=127.0.0.1:9090` |
| Admin UI unreachable | Check firewall: `sudo firewall-cmd --list-all` |
| SDK not loading | Confirm pocketbase.umd.js is in pb_public/ |
| Data not saving | Check API rules are blank on all collections |
| App shows blank page | Open browser DevTools (F12) → Console for errors |
| PocketBase crashes | Check logs: `journalctl --user -u pocketbase -n 50` |

---

## Moving to a Cloud Server Later

When you are ready to host online:
1. Copy the entire basketball-tournament/ folder to your VPS
2. Run the systemd service setup (Step 5) on the server
3. Put Nginx in front as a reverse proxy on port 443
4. Update the API_BASE_URL in index.html to your server domain
5. Set API rules to require authentication for write operations

No code changes required beyond the URL update.
