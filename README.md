# OpenClaw Microsoft Middleware

Centralized Microsoft 365 (Teams, Email, Calendar) integration server for OpenClaw agents.

## Features

- **Microsoft Teams**: Real-time webhooks, send messages, group chat detection, @mention filtering
- **Email (Outlook)**: List, read, send emails, webhook notifications
- **Calendar**: List events, create events with attendees, webhook notifications
- **Multi-agent**: Support for unlimited OpenClaw agents via environment configuration
- **Auto token refresh**: Automatic Microsoft token refresh
- **Webhook validation**: Handles Microsoft Graph webhook validation
- **Subscription management**: Create, list, renew subscriptions automatically
- **Smart filtering**: 
  - Own message detection (prevents loops)
  - Old message filtering (no backfill spam)
  - Duplicate detection
  - Group chat silence (only forwards when @mentioned)

## Installation

```bash
npm install
```

## Configuration

### 1. Copy environment template

```bash
cp .env.example .env
```

### 2. Configure each agent

Edit `.env` and add configuration for each agent. Each agent needs:

```bash
# Agent name prefix (e.g., MAX, SOPHIA, KIM)
{AGENT}_CLIENT_ID=your-azure-client-id
{AGENT}_TENANT_ID=your-azure-tenant-id
{AGENT}_TOKEN_FILE=/path/to/agent-microsoft-tokens.json
{AGENT}_GATEWAY_URL=http://localhost:PORT/hooks/agent
{AGENT}_GATEWAY_TOKEN=your-gateway-token
{AGENT}_DISPLAY_NAME=Agent Display Name
{AGENT}_AGENT_ID=agent-id (optional, defaults to lowercase agent name)
```

**Example for Max:**

```bash
MAX_CLIENT_ID=79b3f60a-ddfe-4029-8af4-1c95a37c6aa7
MAX_TENANT_ID=982780f8-0424-4e57-9cc0-bee3d6acc797
MAX_TOKEN_FILE=/home/user/max-microsoft-tokens.json
MAX_GATEWAY_URL=http://localhost:18789/hooks/agent
MAX_GATEWAY_TOKEN=your-gateway-token-here
MAX_DISPLAY_NAME=Max Ferretti
MAX_AGENT_ID=max
```

### 3. Ensure Microsoft token files exist

Each agent needs a valid Microsoft OAuth token file at the path specified in `{AGENT}_TOKEN_FILE`.

Token file format:
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_in": 3600,
  "obtained_at": 1234567890000
}
```

## Usage

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

### As systemd service

See example in project README.

## API Endpoints

### Health
- `GET /health` - Server health check
- `GET /status/:agent` - Check agent token status

### Teams
- `POST /webhook/teams/:agent` - Teams webhook (Microsoft notifications)
- `POST /api/teams/send` - Send Teams message

### Email
- `POST /webhook/email/:agent` - Email webhook (Microsoft notifications)
- `GET /api/email/list/:agent?limit=10` - List emails
- `GET /api/email/read/:agent/:messageId` - Read email
- `POST /api/email/send` - Send email

### Calendar
- `POST /webhook/calendar/:agent` - Calendar webhook (Microsoft notifications)
- `GET /api/calendar/list/:agent?days=7` - List calendar events
- `POST /api/calendar/create` - Create calendar event

### Subscriptions
- `GET /api/subscription/list/:agent` - List active subscriptions
- `POST /api/subscription/refresh/:agent` - Manually refresh all subscriptions
- `DELETE /api/subscription/:agent/:subscriptionId` - Delete subscription

## How It Works

### Startup
1. Loads agent configurations from `.env`
2. Fetches user IDs for each agent via `/me` endpoint (for @mention detection)
3. Starts subscription managers for each agent
4. Auto-creates/renews webhooks every 5 minutes

### Message Flow (Teams)

1. **Microsoft Graph** sends webhook notification → middleware
2. **Middleware** fetches message details from Graph API
3. **Filters applied:**
   - Own message? Skip (prevents loops)
   - Old message? Skip (no backfill spam)
   - Duplicate? Skip (seen before)
   - Group chat? Check @mentions
     - Not @mentioned? Skip (silence rule)
     - @mentioned? Continue
4. **Forward to agent gateway** if all filters pass
5. **Agent processes** and responds
6. **Agent's response** triggers webhook → filtered as "own message" → no loop

## Subscription Configuration

Edit `config/subscriptions.json` to define webhook resources for each agent:

```json
{
  "max": [
    {
      "resource": "/me/chats/getAllMessages",
      "changeType": "created",
      "notificationUrl": "https://microsoft.acuity.expert/webhook/teams/max",
      "clientState": "max-teams",
      "maxExpirationMinutes": 60
    }
  ]
}
```

## Security

- All tokens stored in separate files (not in env)
- `.env` excluded from git via `.gitignore`
- Webhook validation via Microsoft's validation token
- State tracking prevents replay attacks
- Auto token refresh before expiry

## Troubleshooting

### No messages received
1. Check subscription status: `curl http://localhost:3007/api/subscription/list/max`
2. Check server logs: `tail -f server.log`
3. Verify Cloudflare tunnel is routing to correct port

### Token expired
Tokens auto-refresh. If issues persist:
1. Check token file exists and has `refresh_token`
2. Verify Azure app has correct permissions
3. Check server logs for token refresh errors

### Group chat not working
1. Verify `{AGENT}_DISPLAY_NAME` matches Teams display name exactly
2. Check logs for "Fetched user ID" message at startup
3. Test @mention in group chat

## Architecture

```
Microsoft Graph API
       ↓ (webhook)
Middleware Server (port 3007)
       ↓ (HTTP POST)
OpenClaw Agent Gateways (ports 18789, 19789, etc.)
       ↓
Agent Sessions
```

## License

MIT

## Author

Luca Licata
