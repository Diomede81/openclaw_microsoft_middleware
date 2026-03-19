# OpenClaw Microsoft Middleware

Microsoft 365 (Teams, Email, Calendar) integration middleware for OpenClaw agents.

## Documentation

| Guide | Description |
|-------|-------------|
| [AGENT_INSTALL_GUIDE.md](./AGENT_INSTALL_GUIDE.md) | Complete installation walkthrough with troubleshooting |
| [AGENT_TEAMS_SETUP.md](./AGENT_TEAMS_SETUP.md) | Setting up Teams integration for new agents |
| [TOKEN_MANAGEMENT.md](./TOKEN_MANAGEMENT.md) | OAuth token lifecycle and refresh |
| [SETUP.md](./SETUP.md) | Azure AD app registration setup |

**Quick access from CLI:**
```bash
ms-middleware docs              # Open documentation in browser
ms-middleware docs install      # Show installation guide
ms-middleware docs teams        # Show Teams setup guide
```

## Installation

### From npm (recommended)

```bash
npm install -g @openclaw/microsoft-middleware
```

### From GitHub

```bash
npm install -g github:Diomede81/openclaw_microsoft_middleware
```

### Or clone and link locally

```bash
git clone https://github.com/Diomede81/openclaw_microsoft_middleware.git
cd openclaw_microsoft_middleware
npm install
npm link
```

## Quick Start

```bash
# 1. Create a directory for your deployment
mkdir my-middleware && cd my-middleware

# 2. Initialize configuration
ms-middleware init

# 3. Edit .env with your agent credentials
nano .env

# 4. Generate OAuth tokens for your agents
ms-middleware token <agent-name>
ms-middleware token-device <agent-name>  # For headless environments

# 5. Start the server
ms-middleware start

# 6. (Optional) Install as systemd service
ms-middleware install-service
systemctl --user enable ms-middleware
systemctl --user start ms-middleware
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `ms-middleware start` | Start the middleware server |
| `ms-middleware init` | Create .env config file in current directory |
| `ms-middleware token <agent>` | Generate OAuth token (browser flow) |
| `ms-middleware token-device <agent>` | Generate OAuth token (device code flow) |
| `ms-middleware subscriptions [agent]` | List active Graph subscriptions |
| `ms-middleware status` | Check if server is running |
| `ms-middleware install-service [name]` | Create systemd user service |
| `ms-middleware help` | Show help |

## Updating

```bash
# Update to latest version
npm update -g @openclaw/microsoft-middleware

# Or from GitHub
npm install -g github:Diomede81/openclaw_microsoft_middleware

# Restart if running as service
systemctl --user restart ms-middleware
```

## Configuration

Copy `.env.example` to `.env` and configure your agents:

```env
# Server
PORT=3007
PUBLIC_URL=https://your-webhook-domain.com

# Agent configuration (repeat for each agent)
# Replace AGENTNAME with your agent's name in uppercase
AGENTNAME_CLIENT_ID=your-azure-client-id
AGENTNAME_TENANT_ID=your-azure-tenant-id
AGENTNAME_TOKEN_FILE=/path/to/agentname-tokens.json
AGENTNAME_GATEWAY_URL=http://localhost:18789/hooks/agent
AGENTNAME_GATEWAY_TOKEN=your-gateway-token

# List all enabled agents (comma-separated)
ENABLED_AGENTS=agentname1,agentname2
```

See `.env.example` for all available options.

## Features

- **Multi-agent support** - Configure multiple OpenClaw agents
- **Microsoft Graph webhooks** - Teams messages, email, calendar events
- **Auto token refresh** - Tokens are refreshed automatically
- **Subscription management** - Auto-renew Graph subscriptions
- **Systemd integration** - Easy service installation

## Architecture

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Microsoft     │      │   Middleware    │      │    OpenClaw     │
│   Graph API     │─────▶│   Server        │─────▶│    Gateway      │
│                 │      │   (port 3007)   │      │                 │
└─────────────────┘      └─────────────────┘      └─────────────────┘
       │                         │
       │  Webhooks              │  Forwards events
       └─────────────────────────┘
```

## Requirements

- Node.js >= 18.0.0
- Azure AD app registration with appropriate permissions
- OpenClaw gateway running

## License

MIT
