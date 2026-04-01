# OpenClaw Microsoft Middleware

Microsoft 365 (Teams, Email, Calendar) integration middleware for OpenClaw agents.

## Features

- **Multi-agent support** - Configure multiple OpenClaw agents
- **Microsoft Graph webhooks** - Real-time Teams messages, email, calendar events
- **Session history** - Persistent conversation context across messages
- **Auto token refresh** - Tokens are refreshed automatically
- **Subscription management** - Auto-renew Graph subscriptions
- **Cloudflare Tunnel** - Secure webhook ingress without exposing ports
- **Configuration API** - REST API for programmatic configuration
- **Systemd integration** - Easy service installation

## Quick Start

```bash
# Install globally
npm install -g github:Diomede81/openclaw_microsoft_middleware

# Create config directory
mkdir my-middleware && cd my-middleware

# Initialize configuration
ms-middleware init

# Edit .env with your settings
nano .env

# Generate OAuth tokens for agents
ms-middleware token max
ms-middleware token sophia

# Setup Cloudflare tunnel (optional but recommended)
ms-middleware tunnel setup

# Start the server
ms-middleware start

# Or install as systemd service
ms-middleware install-service
systemctl --user enable ms-middleware
systemctl --user start ms-middleware
```

## Documentation

| Guide | Description |
|-------|-------------|
| [AGENT_INSTALL_GUIDE.md](./AGENT_INSTALL_GUIDE.md) | Complete installation walkthrough |
| [AGENT_TEAMS_SETUP.md](./AGENT_TEAMS_SETUP.md) | Teams integration for agents |
| [SESSIONS.md](./SESSIONS.md) | **Session persistence and conversation history** |
| [TOKEN_MANAGEMENT.md](./TOKEN_MANAGEMENT.md) | OAuth token lifecycle |
| [SETUP.md](./SETUP.md) | Azure AD app registration |

**CLI docs:** `ms-middleware docs <topic>`

---

## CLI Reference

### Server Commands

| Command | Description |
|---------|-------------|
| `ms-middleware start` | Start the middleware server |
| `ms-middleware status` | Check if server is running |
| `ms-middleware install-service [name]` | Create systemd user service |
| `ms-middleware init` | Create .env config in current directory |

### Token Commands

| Command | Description |
|---------|-------------|
| `ms-middleware token <agent>` | Generate OAuth token (browser flow) |
| `ms-middleware token-device <agent>` | Generate OAuth token (device code flow) |

### Session Commands

| Command | Description |
|---------|-------------|
| `ms-middleware sessions stats` | Show session store statistics |
| `ms-middleware sessions list <agent>` | List all sessions for an agent |
| `ms-middleware sessions clear <agent> <chatId>` | Clear messages from a session |

### Tunnel Commands

| Command | Description |
|---------|-------------|
| `ms-middleware tunnel status` | Show tunnel status |
| `ms-middleware tunnel setup` | Full setup: create tunnel, DNS, config, service |
| `ms-middleware tunnel run` | Run cloudflared tunnel (foreground) |
| `ms-middleware tunnel create` | Create a new tunnel |
| `ms-middleware tunnel delete` | Delete the tunnel |
| `ms-middleware tunnel dns` | Configure DNS CNAME record |
| `ms-middleware tunnel config` | Generate cloudflared config file |
| `ms-middleware tunnel service` | Generate systemd service for cloudflared |

### Subscription Commands

| Command | Description |
|---------|-------------|
| `ms-middleware subscriptions` | List all active Graph subscriptions |
| `ms-middleware subscriptions <agent>` | List subscriptions for specific agent |

### Documentation Commands

| Command | Description |
|---------|-------------|
| `ms-middleware docs` | List available documentation |
| `ms-middleware docs install` | Show installation guide |
| `ms-middleware docs teams` | Show Teams setup guide |
| `ms-middleware docs tokens` | Show token management guide |

---

## REST API Reference

Base URL: `http://localhost:3007` (default)

### Health & Status

#### GET /health
Check server health and session statistics.

**Response:**
```json
{
  "status": "ok",
  "agents": ["max", "sophia"],
  "sessions": {
    "totalSessions": 5,
    "totalMessages": 42,
    "maxMessages": 30,
    "injectMessages": 10
  }
}
```

#### GET /status/:agent
Check status for a specific agent.

**Response:**
```json
{
  "agent": "max",
  "tokenValid": true,
  "sessions": [
    {
      "sessionKey": "teams:max:19:abc123...",
      "channel": "teams",
      "messageCount": 12,
      "updatedAt": "2026-03-19 17:00:00"
    }
  ]
}
```

---

### Configuration API

#### GET /api/info
Get middleware info and capabilities.

**Response:**
```json
{
  "ok": true,
  "name": "@openclaw/microsoft-middleware",
  "version": "1.0.0",
  "capabilities": ["teams-messages", "teams-presence", "email-notifications", "calendar-notifications", "session-history", "cloudflare-tunnel"],
  "endpoints": { ... }
}
```

#### GET /api/config
Get current configuration (sensitive values masked).

**Response:**
```json
{
  "ok": true,
  "config": {
    "PORT": "3007",
    "PUBLIC_URL": "https://microsoft.example.com",
    "MAX_CLIENT_ID": "abc1****xyz9",
    ...
  },
  "envPath": "/path/to/.env"
}
```

#### POST /api/config/validate
Validate current configuration.

**Response:**
```json
{
  "ok": true,
  "valid": true,
  "issues": [],
  "warnings": ["sophia: Missing DISPLAY_NAME"],
  "agentCount": 2
}
```

#### POST /api/restart
Request middleware restart.

**Response:**
```json
{
  "ok": true,
  "message": "Restart requested. The middleware will restart shortly."
}
```

---

### Agent Configuration API

#### GET /api/config/agents
List all configured agents.

**Response:**
```json
{
  "ok": true,
  "agents": {
    "max": {
      "name": "max",
      "enabled": true,
      "clientId": "abc-123-xyz",
      "tenantId": "tenant-id",
      "displayName": "Max Ferretti",
      "gatewayUrl": "http://localhost:18789/hooks/agent"
    }
  },
  "enabledAgents": ["max", "sophia"]
}
```

#### POST /api/config/agents
Add or update an agent.

**Request Body:**
```json
{
  "name": "kim",
  "clientId": "your-azure-client-id",
  "tenantId": "your-azure-tenant-id",
  "tokenFile": "/path/to/kim-microsoft-tokens.json",
  "gatewayUrl": "http://localhost:20789/hooks/agent",
  "gatewayToken": "your-gateway-token",
  "displayName": "Kim Assistant",
  "agentId": "kim"
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Agent kim configured. Restart middleware to apply changes.",
  "restartRequired": true
}
```

#### DELETE /api/config/agents/:name
Remove an agent.

**Response:**
```json
{
  "ok": true,
  "message": "Agent kim removed. Restart middleware to apply changes.",
  "restartRequired": true
}
```

---

### Server Configuration API

#### GET /api/config/server
Get server configuration.

**Response:**
```json
{
  "ok": true,
  "server": {
    "port": 3007,
    "publicUrl": "https://microsoft.example.com",
    "nodeEnv": "production"
  }
}
```

#### PUT /api/config/server
Update server configuration.

**Request Body:**
```json
{
  "port": 3007,
  "publicUrl": "https://microsoft.example.com"
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Server config updated. Restart middleware to apply changes.",
  "restartRequired": true
}
```

---

### Cloudflare Configuration API

#### GET /api/config/cloudflare
Get Cloudflare tunnel configuration.

**Response:**
```json
{
  "ok": true,
  "cloudflare": {
    "configured": true,
    "accountId": "abc123",
    "domain": "example.com",
    "subdomain": "microsoft",
    "tunnelName": "ms-middleware",
    "publicUrl": "https://microsoft.example.com"
  }
}
```

#### PUT /api/config/cloudflare
Update Cloudflare configuration.

**Request Body:**
```json
{
  "apiToken": "your-cloudflare-api-token",
  "accountId": "your-account-id",
  "domain": "example.com",
  "subdomain": "microsoft",
  "tunnelName": "ms-middleware"
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Cloudflare config updated.",
  "publicUrl": "https://microsoft.example.com"
}
```

---

### Session Configuration API

#### GET /api/config/sessions
Get session store configuration.

**Response:**
```json
{
  "ok": true,
  "sessions": {
    "maxMessages": 30,
    "injectMessages": 10,
    "dbPath": "./data/sessions.db"
  }
}
```

#### PUT /api/config/sessions
Update session store configuration.

**Request Body:**
```json
{
  "maxMessages": 50,
  "injectMessages": 15,
  "dbPath": "./data/sessions.db"
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Session config updated. Restart middleware to apply changes.",
  "restartRequired": true
}
```

---

### Session Management API

#### GET /sessions
Get session store statistics.

**Response:**
```json
{
  "totalSessions": 5,
  "totalMessages": 42,
  "dbPath": "/path/to/sessions.db",
  "maxMessages": 30,
  "injectMessages": 10
}
```

#### GET /sessions/:agent
List sessions for an agent.

**Response:**
```json
{
  "agent": "max",
  "sessions": [
    {
      "id": 1,
      "session_key": "teams:max:19:abc123...",
      "channel": "teams",
      "chat_id": "19:abc123...",
      "message_count": 12,
      "updated_at": "2026-03-19 17:00:00"
    }
  ]
}
```

#### GET /sessions/:agent/:channel/:chatId
Get messages from a specific session.

**Response:**
```json
{
  "sessionKey": "teams:max:19:abc123...",
  "messages": [
    {
      "id": 1,
      "role": "user",
      "sender_name": "Luca Licata",
      "content": "Hello!",
      "timestamp": "2026-03-19 17:00:00"
    },
    {
      "id": 2,
      "role": "assistant",
      "sender_name": "Max Ferretti",
      "content": "Hi! How can I help?",
      "timestamp": "2026-03-19 17:00:05"
    }
  ]
}
```

#### DELETE /sessions/:agent/:channel/:chatId
Clear messages from a session.

**Response:**
```json
{
  "ok": true,
  "cleared": "teams:max:19:abc123..."
}
```

---

### Email API

#### GET /api/email/list/:agent
List recent emails.

**Query params:** `top` (default: 10), `folder` (default: inbox)

```bash
curl "http://localhost:3007/api/email/list/max?top=5"
```

#### GET /api/email/read/:agent/:messageId
Read a specific email.

```bash
curl "http://localhost:3007/api/email/read/max/AAMkAD..."
```

#### GET /api/email/search/:agent
Search emails.

**Query params:** `q` (required), `top` (default: 10), `folder` (default: inbox)

```bash
curl "http://localhost:3007/api/email/search/max?q=invoice&top=5"
```

#### POST /api/email/send
Send a new email with optional attachments.

**Request Body:**
```json
{
  "agent": "max",
  "to": "recipient@example.com",
  "subject": "Hello",
  "body": "<p>Email body in HTML</p>",
  "attachments": [
    {
      "name": "report.csv",
      "path": "/path/to/file.csv",
      "contentType": "text/csv"
    }
  ]
}
```

**Attachment Options:**
- `path`: File system path (automatically read and base64 encoded)
- `contentBytes`: Pre-encoded base64 string
- `buffer`: Raw buffer (will be encoded)
- `name`: Filename (required)
- `contentType`: MIME type (optional, defaults to `application/octet-stream`)

**Example with multiple attachments:**
```bash
curl -X POST "http://localhost:3007/api/email/send" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "max",
    "to": "user@example.com",
    "subject": "Monthly Reports",
    "body": "<p>Please find attached reports</p>",
    "attachments": [
      {
        "name": "sales.csv",
        "path": "/data/sales.csv",
        "contentType": "text/csv"
      },
      {
        "name": "summary.pdf",
        "path": "/data/summary.pdf",
        "contentType": "application/pdf"
      }
    ]
  }'
```

#### POST /api/email/reply
Reply to an email.

**Request Body:**
```json
{
  "agent": "max",
  "messageId": "AAMkAD...",
  "body": "<p>Reply content</p>",
  "replyAll": false
}
```

#### POST /api/email/forward
Forward an email.

**Request Body:**
```json
{
  "agent": "max",
  "messageId": "AAMkAD...",
  "to": "recipient@example.com",
  "comment": "FYI"
}
```

#### DELETE /api/email/:agent/:messageId
Delete an email.

```bash
curl -X DELETE "http://localhost:3007/api/email/max/AAMkAD..."
```

---

### Calendar API

#### GET /api/calendar/list/:agent
List upcoming calendar events.

**Query params:** `days` (default: 7)

```bash
curl "http://localhost:3007/api/calendar/list/max?days=14"
```

#### GET /api/calendar/event/:agent/:eventId
Get a specific event.

```bash
curl "http://localhost:3007/api/calendar/event/max/AAMkAD..."
```

#### GET /api/calendar/search/:agent
Search calendar events.

**Query params:** `q` (required), `days` (default: 30)

```bash
curl "http://localhost:3007/api/calendar/search/max?q=meeting&days=14"
```

#### POST /api/calendar/create
Create a calendar event.

**Request Body:**
```json
{
  "agent": "max",
  "subject": "Team Meeting",
  "start": "2026-03-20T10:00:00",
  "end": "2026-03-20T11:00:00",
  "location": "Conference Room",
  "attendees": ["colleague@example.com"]
}
```

#### PUT /api/calendar/event/:agent/:eventId
Update a calendar event.

**Request Body:**
```json
{
  "subject": "Updated Title",
  "start": "2026-03-20T11:00:00",
  "end": "2026-03-20T12:00:00",
  "location": "New Location"
}
```

#### DELETE /api/calendar/event/:agent/:eventId
Delete a calendar event.

```bash
curl -X DELETE "http://localhost:3007/api/calendar/event/max/AAMkAD..."
```

---

### Webhook Endpoints

These endpoints receive notifications from Microsoft Graph.

| Endpoint | Description |
|----------|-------------|
| `POST /webhook/teams/:agent` | Teams message notifications |
| `POST /webhook/email/:agent` | Email notifications |
| `POST /webhook/calendar/:agent` | Calendar event notifications |

**Note:** These are called by Microsoft Graph, not by users directly.

---

## Configuration Reference

### Environment Variables

#### Server Configuration
```env
PORT=3007                          # Server port
PUBLIC_URL=https://microsoft.example.com  # Public webhook URL
NODE_ENV=production                # Environment
```

#### Agent Configuration (repeat for each agent)
```env
ENABLED_AGENTS=max,sophia          # Comma-separated list

MAX_CLIENT_ID=your-azure-client-id
MAX_TENANT_ID=your-azure-tenant-id
MAX_TOKEN_FILE=/path/to/max-microsoft-tokens.json
MAX_GATEWAY_URL=http://localhost:18789/hooks/agent
MAX_GATEWAY_TOKEN=your-gateway-token
MAX_DISPLAY_NAME=Max Ferretti
MAX_AGENT_ID=max
```

#### Session Store Configuration
```env
SESSION_MAX_MESSAGES=30            # Max messages before truncation
SESSION_INJECT_MESSAGES=10         # Messages to inject into prompt
SESSION_DB_PATH=./data/sessions.db # Database location
```

#### Cloudflare Tunnel Configuration
```env
CLOUDFLARE_API_TOKEN=your-api-token
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_DOMAIN=example.com
CLOUDFLARE_SUBDOMAIN=microsoft     # Default: microsoft
CLOUDFLARE_TUNNEL_NAME=ms-middleware  # Default: ms-middleware
```

---

## Architecture

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Microsoft     │      │   Middleware    │      │    OpenClaw     │
│   Graph API     │─────▶│   Server        │─────▶│    Gateway      │
│                 │      │   (port 3007)   │      │                 │
└─────────────────┘      └─────────────────┘      └─────────────────┘
       │                         │                         │
       │  Webhooks              │  Session Store          │  Agent
       │                        │  (SQLite)               │  Processing
       ▼                        ▼                         ▼
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Cloudflare    │      │   Config API    │      │   Teams Reply   │
│   Tunnel        │      │   (REST)        │      │   Scripts       │
└─────────────────┘      └─────────────────┘      └─────────────────┘
```

---

## Requirements

- Node.js >= 18.0.0
- Azure AD app registration with appropriate permissions
- OpenClaw gateway running
- Cloudflare account (for tunnel, optional)

## License

MIT
