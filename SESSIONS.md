# Session Persistence for Teams

This document explains how conversation history is maintained across Teams messages, working around the OpenClaw hooks session limitation.

## The Problem

OpenClaw's `/hooks/agent` endpoint has a known limitation (issues #18027, #11665, #42621): it always creates a **new session** for each webhook request, even when a consistent `sessionKey` is provided. This means agents lose conversation context between messages.

**Example without session persistence:**
```
User: "What's my account balance?"
Agent: "Your balance is £5,000"
User: "Transfer £100 to savings"
Agent: "I don't understand. What balance are you referring to?"  ← Lost context!
```

## The Solution

The middleware implements its own session store that:
1. **Stores all messages** (user + agent) in a SQLite database
2. **Injects recent history** into each prompt sent to the agent
3. **Auto-truncates** old messages to prevent unbounded growth

**Example with session persistence:**
```
User: "What's my account balance?"
Agent: "Your balance is £5,000"
User: "Transfer £100 to savings"
Agent: "I'll transfer £100 from your account (balance £5,000) to savings."  ← Has context!
```

## How It Works

### 1. Session Key Structure

Each conversation gets a unique session key:
```
{channel}:{agent}:{chatId}

Examples:
teams:max:19:15f6df21-5683-40eb-b385-30154a4d6c02_4a2d20b2-d35a-4423-8358-989b7fff4b2e@unq.gbl.spaces
teams:sophia:19:22e69c79-65d5-4e21-84b7-6348c5555147_e211f5f5-2e3a-4519-aaae-8fd0b465b6f7@unq.gbl.spaces
```

This ensures:
- Each Teams chat has its own history
- Different agents have separate histories
- Teams sessions are isolated from WhatsApp sessions

### 2. Message Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        INCOMING MESSAGE                              │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  1. Microsoft Graph sends webhook to middleware                      │
│     POST /webhook/teams/:agent                                       │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  2. Middleware stores message in SQLite                              │
│     INSERT INTO messages (session_key, role, content, sender_name)  │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  3. Middleware retrieves last N messages from session                │
│     SELECT * FROM messages WHERE session_key = ? ORDER BY timestamp │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  4. Middleware formats history and injects into prompt               │
│                                                                      │
│     --- Previous conversation (5 messages) ---                       │
│     [Luca Licata]: What's my account balance?                        │
│     [Max Ferretti]: Your balance is £5,000                           │
│     [Luca Licata]: Any pending transactions?                         │
│     [Max Ferretti]: You have 2 pending: £50 and £25                  │
│     [Luca Licata]: Transfer £100 to savings                          │
│     --- End of previous conversation ---                             │
│                                                                      │
│     💬 Teams message from Luca Licata: "Transfer £100 to savings"   │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  5. Forward to OpenClaw gateway with enriched prompt                 │
│     POST http://localhost:18789/hooks/agent                          │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  6. Agent processes with full context, sends reply                   │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  7. Agent's reply triggers Graph webhook back to middleware          │
│     Middleware detects own message (by userId), stores it            │
│     but does NOT forward to gateway (prevents loop)                  │
└─────────────────────────────────────────────────────────────────────┘
```

### 3. Database Schema

```sql
-- Sessions table (metadata)
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  session_key TEXT UNIQUE,      -- "teams:max:19:abc123..."
  agent TEXT,                   -- "max"
  channel TEXT,                 -- "teams"
  chat_id TEXT,                 -- "19:abc123..."
  created_at DATETIME,
  updated_at DATETIME,
  metadata TEXT                 -- JSON: {"chatType": "direct", "displayName": "Max"}
);

-- Messages table (conversation history)
CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  session_key TEXT,             -- Foreign key to sessions
  role TEXT,                    -- "user" or "assistant"
  sender_name TEXT,             -- "Luca Licata" or "Max Ferretti"
  content TEXT,                 -- Message text
  timestamp DATETIME,
  message_id TEXT               -- Teams message ID for deduplication
);
```

### 4. Configuration

```env
# Maximum messages to keep per session (older are deleted)
SESSION_MAX_MESSAGES=30

# Number of recent messages to inject into each prompt
SESSION_INJECT_MESSAGES=10

# Database file location
SESSION_DB_PATH=./data/sessions.db
```

### 5. Self-Message Filtering

To prevent infinite loops, the middleware detects and filters messages sent by the agent itself:

```javascript
// Primary filter: User ID (most reliable)
const isOwnMessage = (config.userId && messageUserId === config.userId);

// Fallback: Display name (if userId unavailable)
if (!messageUserId && from === config.displayName) {
  isOwnMessage = true;
}

if (isOwnMessage) {
  // Store for context, but don't forward to gateway
  sessionStore.addMessage(sessionKey, 'assistant', content, displayName);
  continue;  // Skip forwarding
}
```

## API Endpoints

### View Session Statistics
```bash
curl http://localhost:3007/sessions
```
```json
{
  "totalSessions": 5,
  "totalMessages": 42,
  "maxMessages": 30,
  "injectMessages": 10
}
```

### List Sessions for Agent
```bash
curl http://localhost:3007/sessions/max
```
```json
{
  "agent": "max",
  "sessions": [
    {
      "session_key": "teams:max:19:abc123...",
      "channel": "teams",
      "message_count": 12,
      "updated_at": "2026-03-19 17:00:00"
    }
  ]
}
```

### View Session Messages
```bash
curl "http://localhost:3007/sessions/max/teams/19:abc123..."
```
```json
{
  "sessionKey": "teams:max:19:abc123...",
  "messages": [
    {"role": "user", "sender_name": "Luca", "content": "Hello"},
    {"role": "assistant", "sender_name": "Max", "content": "Hi!"}
  ]
}
```

### Clear Session
```bash
curl -X DELETE "http://localhost:3007/sessions/max/teams/19:abc123..."
```

## CLI Commands

```bash
# View statistics
ms-middleware sessions stats

# List sessions for an agent
ms-middleware sessions list max

# Clear a session
ms-middleware sessions clear max "19:abc123..."
```

## Token Cost Considerations

Injecting conversation history adds tokens to each request:

| Messages Injected | Approximate Tokens | Cost Impact |
|-------------------|-------------------|-------------|
| 5 messages | ~500-1,000 | Minimal |
| 10 messages | ~1,000-2,000 | Low |
| 20 messages | ~2,000-4,000 | Moderate |
| 30 messages | ~3,000-6,000 | Higher |

**Recommendations:**
- Use `SESSION_INJECT_MESSAGES=10` for most cases
- Increase if agents need more context (e.g., complex multi-step tasks)
- Decrease for high-volume, simple interactions

## Troubleshooting

### Agent doesn't remember previous messages
1. Check session store is working: `curl http://localhost:3007/sessions`
2. Verify messages are being stored: `ms-middleware sessions list <agent>`
3. Check middleware logs for errors

### Agent responds to its own messages (loop)
1. Verify `DISPLAY_NAME` matches Microsoft Graph: 
   ```bash
   curl -H "Authorization: Bearer $TOKEN" https://graph.microsoft.com/v1.0/me
   ```
2. Check middleware startup logs for userId fetch
3. Ensure displayName in .env matches exactly

### Database grows too large
1. Reduce `SESSION_MAX_MESSAGES`
2. Clear old sessions: `ms-middleware sessions clear <agent> <chatId>`
3. Delete database and restart (loses all history): `rm ./data/sessions.db`

## Future Improvements

When OpenClaw fixes the hooks session issue (#18027, #11665), this workaround can be simplified or removed. The middleware will then just pass through the `sessionKey` and let OpenClaw handle persistence natively.

Until then, this session store provides reliable conversation continuity for Teams integrations.
