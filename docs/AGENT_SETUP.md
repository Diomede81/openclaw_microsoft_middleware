# Microsoft Middleware - Setup Instructions

**Service:** microsoft-middleware  
**Version:** 2.0.0  
**Port:** 3007  
**Purpose:** Microsoft 365 integration for OpenClaw agents - Email, Calendar, Teams messaging, and webhooks.

---

## 🔧 Prerequisites

### Required Software

| Dependency | Purpose | Check Command |
|------------|---------|---------------|
| **Node.js** | Runtime | `node --version` |
| **SQLite3** | Token storage | `sqlite3 --version` |

### Microsoft Azure App Registration

You need an Azure AD application with the following:

1. **Application (client) ID**
2. **Directory (tenant) ID** 
3. **Client secret** (for daemon flows) OR
4. **Device code flow** enabled (for user flows)

**Required API Permissions:**
- `Mail.Read` - Read user mail
- `Mail.Send` - Send mail
- `Calendars.ReadWrite` - Read/write calendar
- `Chat.ReadWrite` - Teams chat
- `ChannelMessage.Send` - Send Teams channel messages
- `User.Read` - Read user profile

---

## 🚀 Quick Start

### 1. Start the Service

```bash
# Via systemd (recommended)
systemctl --user start microsoft-middleware

# Or directly
cd ~/openclaw_microsoft_middleware
node bin/ms-middleware.js start
```

### 2. Verify Service is Running

```bash
curl -s http://localhost:3007/health | jq
```

Expected output:
```json
{
  "status": "ok",
  "version": "2.0.0",
  "agents": ["luca", "max", "sophia"]
}
```

---

## 🔑 Token Management

### Add Agent via Device Code Flow

```bash
# Start device auth for an agent
ms-middleware token-device <agent-name>

# Example:
ms-middleware token-device luca
```

This will:
1. Display a device code and URL
2. Open browser (or display URL to visit)
3. User signs in with Microsoft account
4. Token is saved to SQLite database

### Check Agent Sessions

```bash
curl -s http://localhost:3007/sessions | jq
```

### Refresh All Tokens

```bash
ms-middleware token-refresh-all
```

---

## 📧 Email Operations

### List Emails

```bash
# List recent emails for an agent
curl -s "http://localhost:3007/api/email/list/luca?top=10" | jq

# Filter by folder
curl -s "http://localhost:3007/api/email/list/luca?folder=inbox&top=5" | jq
```

### Read Email

```bash
curl -s "http://localhost:3007/api/email/read/luca/<messageId>" | jq
```

### Send Email

```bash
curl -X POST "http://localhost:3007/api/email/send" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "max",
    "to": "recipient@example.com",
    "subject": "Subject line",
    "body": "<p>HTML body content</p>",
    "isHtml": true
  }'
```

### Reply to Email

```bash
curl -X POST "http://localhost:3007/api/email/reply" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "max",
    "messageId": "<original-message-id>",
    "body": "<p>Reply content</p>"
  }'
```

### Forward Email

```bash
curl -X POST "http://localhost:3007/api/email/forward" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "max",
    "messageId": "<message-id>",
    "to": "recipient@example.com",
    "comment": "FYI - see below"
  }'
```

---

## 📅 Calendar Operations

### List Events

```bash
# Get events for next N days
curl -s "http://localhost:3007/api/calendar/list/luca?days=7" | jq

# Response includes onlineMeeting.joinUrl for Teams meetings
```

### Get Event Details

```bash
curl -s "http://localhost:3007/api/calendar/event/luca/<eventId>" | jq
```

### Create Event

```bash
curl -X POST "http://localhost:3007/api/calendar/create" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "luca",
    "subject": "Meeting Title",
    "start": "2026-03-25T10:00:00",
    "end": "2026-03-25T11:00:00",
    "location": "Teams",
    "attendees": ["person@example.com"],
    "isOnline": true
  }'
```

### Update Event

```bash
curl -X PUT "http://localhost:3007/api/calendar/event/luca/<eventId>" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Updated Title",
    "location": "New Location"
  }'
```

### Delete Event

```bash
curl -X DELETE "http://localhost:3007/api/calendar/event/luca/<eventId>"
```

---

## 💬 Teams Operations

### Send Chat Message

```bash
# Reply to a Teams chat
node ~/clawd/max-teams-reply.js '<chatId>' '<HTML message>'

# Or via API
curl -X POST "http://localhost:3007/api/teams/chat/send" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "max",
    "chatId": "<chat-id>",
    "message": "<p>Message content</p>"
  }'
```

### Get Chat Messages

```bash
curl -s "http://localhost:3007/api/teams/chat/luca/<chatId>/messages" | jq
```

---

## 🔔 Webhooks

### Real-time Notifications

The middleware supports Microsoft Graph webhooks for:
- New emails
- Calendar changes
- Teams messages

### Configure Webhook Forwarding

Webhooks are forwarded to OpenClaw gateway for processing.

```bash
# Check subscription status
curl -s http://localhost:3007/api/subscriptions | jq

# Renew subscriptions
curl -X POST http://localhost:3007/api/subscriptions/renew
```

---

## 📡 API Reference

### Health & Status
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/sessions` | GET | List agent sessions |
| `/api/setup` | GET | Setup instructions |

### Email
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/email/list/:agent` | GET | List emails |
| `/api/email/read/:agent/:id` | GET | Read email |
| `/api/email/send` | POST | Send email |
| `/api/email/reply` | POST | Reply to email |
| `/api/email/forward` | POST | Forward email |
| `/api/email/:agent/:id` | DELETE | Delete email |

### Calendar
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/calendar/list/:agent` | GET | List events |
| `/api/calendar/event/:agent/:id` | GET | Get event |
| `/api/calendar/create` | POST | Create event |
| `/api/calendar/event/:agent/:id` | PUT | Update event |
| `/api/calendar/event/:agent/:id` | DELETE | Delete event |

### Teams
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/teams/chat/:agent/:chatId/messages` | GET | Get messages |
| `/api/teams/chat/send` | POST | Send message |

---

## ✅ Verification Checklist

### 1. Service Running
```bash
curl -s http://localhost:3007/health | jq '.status'
# Expected: "ok"
```

### 2. Agents Configured
```bash
curl -s http://localhost:3007/sessions | jq 'keys'
# Expected: list of agent names
```

### 3. Test Email Access
```bash
curl -s "http://localhost:3007/api/email/list/luca?top=1" | jq '.[0].subject'
# Expected: email subject
```

### 4. Test Calendar Access
```bash
curl -s "http://localhost:3007/api/calendar/list/luca?days=1" | jq '.[0].subject'
# Expected: event subject
```

---

## 🚨 Troubleshooting

### "Token not found for agent"
1. Run device auth: `ms-middleware token-device <agent>`
2. Complete Microsoft sign-in
3. Verify: `curl http://localhost:3007/sessions`

### "Token expired"
```bash
# Refresh tokens
ms-middleware token-refresh-all

# Or for specific agent
ms-middleware token-refresh <agent>
```

### "Insufficient privileges"
1. Check Azure AD app permissions
2. Ensure admin consent granted
3. Re-run device auth flow

### Calendar missing onlineMeeting.joinUrl
- Verify the meeting was created as a Teams meeting
- Check the event via Graph API directly
- Calendar list endpoint includes `onlineMeeting` field

### Port 3007 in use
```bash
lsof -i :3007
kill $(lsof -t -i :3007)
```

---

## 📂 Data Storage

- **Token Database:** `data/tokens.db`
- **Subscriptions:** `data/subscriptions.db`
- **Logs:** stdout (via systemd journal)

---

## 🔗 Integration with Other Skills

| Skill | Usage |
|-------|-------|
| agent-meeting-skill | Calendar access, email delivery |
| token-manager-skill | (separate - not used by middleware) |

### Calendar Integration for Meeting Skill

The meeting skill uses this middleware to:
1. Poll calendar for upcoming meetings
2. Extract `onlineMeeting.joinUrl` for auto-join
3. Send email summaries after meetings

---

*This document was auto-generated. For updates, check `/api/setup` endpoint.*
