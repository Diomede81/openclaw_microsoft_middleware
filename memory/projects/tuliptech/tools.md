# Tuliptech Tools & Commands

## Email (via Microsoft Middleware)

### Read Luca's email
```bash
curl -s "http://localhost:3007/api/email/list/luca?top=10" | jq
curl -s "http://localhost:3007/api/email/read/luca/<messageId>" | jq
```

### Send as Max
```bash
curl -X POST "http://localhost:3007/api/email/send" \
  -H "Content-Type: application/json" \
  -d '{"agent":"max","to":"email@example.com","subject":"Subject","body":"<p>HTML body</p>"}'
```

### Reply to email
```bash
curl -X POST "http://localhost:3007/api/email/reply" \
  -H "Content-Type: application/json" \
  -d '{"agent":"max","messageId":"<id>","body":"<p>Reply</p>"}'
```

### Search emails
```bash
curl -s "http://localhost:3007/api/email/search/luca?q=invoice&top=10" | jq
```

## Teams

### Send message to channel
```bash
node ~/clawd/memory/projects/microsoft-integration/scripts/max-teams-reply.js '<chatId>' '<HTML message>'
```

### Common chat IDs
- Leadership: `19:115ed03fca964c769ce48a5bcfd49ab6@thread.v2`
- AI Team: `19:a26774df269e4bea8d529104dfa61abd@thread.v2`
- Empathika: `19:df5f3e2a7e3444d69f6f95c984937321@thread.v2`

## Calendar (via Microsoft Middleware)

### List Luca's upcoming events
```bash
curl -s "http://localhost:3007/api/calendar/list/luca?days=7" | jq
```

### Get specific event
```bash
curl -s "http://localhost:3007/api/calendar/event/luca/<eventId>" | jq
```

### Create event
```bash
curl -X POST "http://localhost:3007/api/calendar/create" \
  -H "Content-Type: application/json" \
  -d '{"agent":"luca","subject":"Meeting","start":"2026-03-20T10:00:00","end":"2026-03-20T11:00:00","location":"Teams","attendees":["email@example.com"]}'
```

### Search events
```bash
curl -s "http://localhost:3007/api/calendar/search/luca?q=meeting&days=30" | jq
```

## User Lookup
```bash
# Find Tuliptech user
curl -s "https://graph.microsoft.com/v1.0/users?\$filter=startswith(displayName,'Name')" \
  -H "Authorization: Bearer <token>"
```

## Token Management
All tokens managed by Microsoft Middleware (port 3007).
Tokens stored in SQLite database: `~/microsoft-middleware/data/tokens.db`

Add/refresh token:
```bash
ms-middleware token-device <agent>
```

---

**Last Updated:** 2026-03-20 (Migrated to middleware API)
