# TOOLS.md - Local Notes
*Full tool reference moved to `memory/reference/tools-full.md` — use memorySearch for recall.*

## Important Rules
- **Ports/tunnels:** ALWAYS ask Luca before opening. Exception: meeting joins.
- **S3 hosting:** ALWAYS use S3, never local. Files stored in `max-agent-s3-bucket` (eu-north-1)
- **Public URLs:** ALWAYS use HTTPS acuity.expert domains, NEVER provide S3 URLs
- **AWS credentials:** encrypted in `.secrets/credentials.age`

### Public Websites (HTTPS via Cloudflare Workers):
- SuperHire: https://superhire.acuity.expert
- SuperHire pitch: https://pitch.acuity.expert
- Empathika (long presentation): https://empathika.acuity.expert/
- Empathika (short presentation): https://empathika.acuity.expert/pitch.html

## Microsoft Integration (Email, Calendar, Teams)

**ALL Microsoft 365 operations via Microsoft Middleware API** (port 3007)
**Docs:** `memory/projects/microsoft-integration/README.md`
**Architecture:** Webhook-based, real-time delivery, SQLite token storage

### ⚠️ CRITICAL: Agent Selection
- **Luca's calendar/email** → use agent `luca`
- **Max's mailbox** (for sending as Max) → use agent `max`
- **Sophia's mailbox** → use agent `sophia`

**DEFAULT: When Luca asks "check my calendar" or "check my emails" → ALWAYS use `luca`, NEVER `max`**

### Email
```bash
# List LUCA's recent emails (DEFAULT for "check my emails")
curl -s "http://localhost:3007/api/email/list/luca?top=5" | jq '.[] | {subject, from: .from.emailAddress.name}'

# List Max's emails (only for Max-specific tasks)
curl -s "http://localhost:3007/api/email/list/max?top=5" | jq '.[] | {subject, from: .from.emailAddress.name}'

# Read specific email
curl -s "http://localhost:3007/api/email/read/luca/<messageId>" | jq

# Search emails
curl -s "http://localhost:3007/api/email/search/luca?q=invoice&top=10" | jq

# Send email
curl -X POST "http://localhost:3007/api/email/send" \
  -H "Content-Type: application/json" \
  -d '{"agent":"max","to":"email@example.com","subject":"Subject","body":"<p>HTML body</p>"}'

# Reply to email
curl -X POST "http://localhost:3007/api/email/reply" \
  -H "Content-Type: application/json" \
  -d '{"agent":"max","messageId":"<id>","body":"<p>Reply</p>"}'

# Forward email
curl -X POST "http://localhost:3007/api/email/forward" \
  -H "Content-Type: application/json" \
  -d '{"agent":"max","messageId":"<id>","to":"recipient@example.com","comment":"FYI"}'

# Delete email
curl -X DELETE "http://localhost:3007/api/email/luca/<messageId>"
```

### Calendar
```bash
# List LUCA's upcoming events (DEFAULT for "check my calendar")
curl -s "http://localhost:3007/api/calendar/list/luca?days=7" | jq '.[] | {subject, start: .start.dateTime}'

# List Max's calendar (only for Max-specific tasks)
curl -s "http://localhost:3007/api/calendar/list/max?days=7" | jq '.[] | {subject, start: .start.dateTime}'

# Get specific event
curl -s "http://localhost:3007/api/calendar/event/luca/<eventId>" | jq

# Search events
curl -s "http://localhost:3007/api/calendar/search/luca?q=meeting&days=30" | jq

# Create event
curl -X POST "http://localhost:3007/api/calendar/create" \
  -H "Content-Type: application/json" \
  -d '{"agent":"luca","subject":"Meeting","start":"2026-03-20T10:00:00","end":"2026-03-20T11:00:00","location":"Teams","attendees":["email@example.com"]}'

# Update event
curl -X PUT "http://localhost:3007/api/calendar/event/luca/<eventId>" \
  -H "Content-Type": application/json" \
  -d '{"subject":"Updated Title","location":"New Location"}'

# Delete event
curl -X DELETE "http://localhost:3007/api/calendar/event/luca/<eventId>"
```

### Teams
```bash
# Reply to Teams message
node ~/clawd/memory/projects/microsoft-integration/scripts/max-teams-reply.js '<chatId>' '<HTML message>'
```

### Token Management
```bash
# All tokens stored in SQLite database: ~/microsoft-middleware/data/tokens.db
# Middleware handles automatic refresh

# Add/refresh token for an agent
ms-middleware token-device <agent>  # Interactive device auth flow

# Batch refresh all tokens
~/microsoft-middleware/scripts/refresh-tokens.sh

# View token status
curl -s "http://localhost:3007/sessions" | jq
```

## Other Daily Commands

### Todoist
```bash
node ~/clawd/todoist.js list|add|complete <id>|projects
```

### Instagram
```bash
node ~/clawd/scripts/instagram-post.js post|carousel|feed
node ~/clawd/scripts/instagram-auth.js refresh  # Weekly token refresh
```

### Meeting Join (Voice Agent v2)
```bash
cd ~/clawd/recall-voice-agent && node voice-relay-v2.cjs  # Start relay FIRST
node join-voice-meeting-v2.js "<meeting_url>"              # Join with voice
# Uses Cloudflare tunnel (meetings.acuity.expert) — no ngrok needed
```

### YouTube Transcripts
```bash
source ~/clawd/livekit-voice-env/bin/activate
python ~/clawd/scripts/youtube-transcript.py "URL" [lang]
```

### SuperHire Deploy (S3 + Cache Busting)
```bash
node ~/clawd/scripts/deploy-superhire.js              # Deploy all files
node ~/clawd/scripts/deploy-superhire.js --file index.html  # Deploy one file
```

### Browser Automation
```bash
bash ~/clawd/scripts/start-xvfb-chrome.sh  # Virtual browser for JS-heavy sites
```

### Web Scraping (Crawlee)
```bash
node ~/clawd/scripts/crawlee-scraper.js <url> [options]
# Options: --mode=cheerio|playwright --format=json|markdown|text --output=<file>
```

## Monitoring

### Sentry Error Check (Empathika)
```bash
/home/lucalicata/.nvm/versions/node/v25.5.0/bin/node ~/clawd/scripts/check-sentry-errors.js
```
- Runs daily at 9 AM, alerts Empathika Team on Teams if ≥500 errors in weekly report

## Key Infrastructure
- **Microsoft Middleware:** port 3007, tunnel → microsoft.acuity.expert
- **Meeting relay:** port 3002, tunnel → meetings.acuity.expert
- **Services:** `microsoft-middleware`, `acuity-cloudflared` (systemd user)
- **Age secrets:** `~/clawd/scripts/age-secrets.js` (readSecret/writeSecret)

## Deprecated
- ❌ Old `*-microsoft-tokens.json` files → archived, use middleware API
- ❌ Legacy email/calendar scripts → archived, use middleware API
- ❌ Manual token refresh → middleware handles it automatically
