# OpenClaw Microsoft Middleware

Centralized Microsoft 365 (Teams, Email, Calendar) integration server for OpenClaw agents.

## Features

- **Microsoft Teams**: Webhooks, send messages, subscriptions
- **Email (Outlook)**: List, read, send emails, webhooks, subscriptions
- **Calendar**: List events, create events with attendees
- **Multi-agent**: Support for multiple OpenClaw agents (Max, Sophia, Kim, etc.)
- **Auto token refresh**: Automatic Microsoft token refresh
- **Webhook validation**: Handles Microsoft Graph webhook validation
- **Subscription management**: Create, list, renew subscriptions

## Installation

```bash
npm install
```

## Configuration

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Edit `.env` with your agent configurations

3. Ensure Microsoft token files exist for each agent

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
See `docs/systemd-setup.md`

## API Endpoints

### Health
- `GET /health` - Server health check
- `GET /status/:agent` - Check agent token status

### Teams
- `POST /webhook/teams/:agent` - Teams webhook (Microsoft notifications)
- `POST /api/teams/send` - Send Teams message
- `POST /api/subscription/teams/:agent` - Create Teams subscription

### Email
- `POST /webhook/email/:agent` - Email webhook (Microsoft notifications)
- `GET /api/email/list/:agent?limit=10` - List emails
- `GET /api/email/read/:agent/:messageId` - Read email
- `POST /api/email/send` - Send email
- `POST /api/subscription/email/:agent` - Create email subscription

### Calendar
- `GET /api/calendar/list/:agent?days=7` - List calendar events
- `POST /api/calendar/create` - Create calendar event

### Subscriptions
- `GET /api/subscription/list/:agent` - List active subscriptions
- `POST /api/subscription/renew/:agent/:subscriptionId` - Renew subscription

## Agents

Configured agents: `max`, `sophia`, `kim`

Each agent needs:
- Microsoft Azure App Registration (Client ID, Tenant ID)
- Token file with refresh token
- OpenClaw gateway URL and token

## Architecture

```
Microsoft Graph API
       ↓
Middleware Server (port 3007)
       ↓
OpenClaw Agent Gateways
```

## License

MIT

## Author

Luca Licata
