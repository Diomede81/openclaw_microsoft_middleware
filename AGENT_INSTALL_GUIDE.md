# Microsoft Middleware Installation Guide for OpenClaw Agents

**Purpose:** Step-by-step instructions for installing and configuring the Microsoft 365 integration middleware on a new system.

---

## Prerequisites

Before starting, ensure you have:
- [ ] Node.js >= 18.0.0 installed
- [ ] GitHub access token (for private repo access)
- [ ] Azure AD app registration credentials for each agent
- [ ] OpenClaw gateway running with hooks endpoint available

---

## Installation Steps

### 1. Clone and Link the Package

```bash
# Clone the repository (use token for private repo)
cd /tmp
git clone https://<GITHUB_TOKEN>@github.com/Diomede81/openclaw_microsoft_middleware.git

# Install dependencies and link globally
cd openclaw_microsoft_middleware
npm install
npm link
```

**⚠️ Known Issue:** Do NOT use `npm install -g github:...` directly - it creates symlinks to temp directories that get cleaned up. Always clone first, then `npm link`.

### 2. Create Configuration Directory

```bash
# Create a dedicated directory for this deployment
mkdir -p ~/microsoft-middleware
cd ~/microsoft-middleware

# Initialize configuration
ms-middleware init
```

This creates a `.env` file from the template.

### 3. Configure .env File

Edit `~/microsoft-middleware/.env` with your agent credentials:

```env
# Server Configuration
PORT=3007
NODE_ENV=production
PUBLIC_URL=https://your-webhook-domain.com
WEBHOOK_BASE_URL=https://your-webhook-domain.com

# Feature Flags
FORWARD_EMAIL_NOTIFICATIONS=true
FORWARD_CALENDAR_NOTIFICATIONS=true

# Enabled Agents (comma-separated)
ENABLED_AGENTS=agent1,agent2

# Agent Configuration (repeat for each agent)
AGENT1_CLIENT_ID=<azure-client-id>
AGENT1_TENANT_ID=<azure-tenant-id>
AGENT1_TOKEN_FILE=/path/to/agent1-microsoft-tokens.json
AGENT1_GATEWAY_URL=http://localhost:18789/hooks/agent
AGENT1_GATEWAY_TOKEN=<gateway-jwt-token>
AGENT1_DISPLAY_NAME=Agent One
AGENT1_AGENT_ID=agent1
```

**⚠️ Important Notes:**
- `TOKEN_FILE` paths must be absolute paths
- Token files must exist and be readable (create empty JSON `{}` if generating fresh)
- Gateway tokens are JWTs from the OpenClaw gateway config

### 4. Generate OAuth Tokens

For each agent, generate Microsoft OAuth tokens:

```bash
cd ~/microsoft-middleware

# Browser-based flow (requires display/browser)
ms-middleware token agent1

# OR device code flow (for headless/SSH environments)
ms-middleware token-device agent1
```

**⚠️ Token Generation Notes:**
- Browser flow opens a local server on port 3001 (configurable via `OAUTH_CALLBACK_PORT`)
- Device code flow is better for remote/headless systems
- Tokens are saved to the path specified in `{AGENT}_TOKEN_FILE`
- Tokens auto-refresh, but initial generation requires manual auth

### 5. Install as Systemd Service

```bash
cd ~/microsoft-middleware
ms-middleware install-service microsoft-middleware
```

Then enable and start:

```bash
systemctl --user daemon-reload
systemctl --user enable microsoft-middleware
systemctl --user start microsoft-middleware
```

### 6. Verify Installation

```bash
# Check service status
systemctl --user status microsoft-middleware

# Check via CLI
ms-middleware status

# Check health endpoint
curl http://localhost:3007/health
```

Expected output:
```json
{"status":"ok","agents":["agent1","agent2"]}
```

---

## Troubleshooting

### Port Already in Use

```
Error: listen EADDRINUSE: address already in use :::3007
```

**Solution:**
```bash
# Find what's using the port
lsof -i :3007

# Kill the process
kill <PID>

# Restart service
systemctl --user restart microsoft-middleware
```

### Token File Not Found

```
Error fetching user ID: Failed to read token file for agent: ENOENT
```

**Solution:**
- Verify the path in `{AGENT}_TOKEN_FILE` is correct and absolute
- Ensure the file exists (run `ms-middleware token <agent>` to generate)
- Check file permissions (should be readable by the user running the service)

### Token Refresh Fails

```
AADSTS70011: The provided request must include a 'scope' input parameter
```

**Solution:**
This usually means the token was generated with incompatible scopes. Regenerate:
```bash
ms-middleware token <agent>
```

### Service Fails Immediately

Check the service logs:
```bash
journalctl --user -u microsoft-middleware -n 50 --no-pager
```

Common causes:
- Missing `.env` file in working directory
- Invalid JSON in token files
- Network issues reaching Microsoft Graph API

### npm link Not Working

If `ms-middleware` command not found after `npm link`:

```bash
# Check where npm links binaries
npm bin -g

# Ensure that directory is in PATH
export PATH="$PATH:$(npm bin -g)"

# Or use full path
$(npm bin -g)/ms-middleware help
```

---

## Updating

To update to the latest version:

```bash
cd /tmp/openclaw_microsoft_middleware
git pull origin master
npm install
npm link

# Restart service
systemctl --user restart microsoft-middleware
```

---

## Directory Structure After Installation

```
~/microsoft-middleware/
├── .env                    # Your configuration (gitignored)
└── (logs written to stdout, captured by systemd)

/tmp/openclaw_microsoft_middleware/
├── bin/
│   └── ms-middleware.js    # CLI entry point
├── lib/
│   ├── server.js           # Main server
│   ├── subscription-manager.js
│   ├── config/
│   └── webhooks/
├── scripts/
│   ├── generate-token.js
│   └── generate-token-device.js
└── tools/
    ├── list-all-subscriptions.js
    ├── create-test-subscription.js
    └── debug-last-message.js
```

---

## CLI Reference

| Command | Description |
|---------|-------------|
| `ms-middleware start` | Start the server (foreground) |
| `ms-middleware init` | Create .env in current directory |
| `ms-middleware token <agent>` | Generate OAuth token (browser) |
| `ms-middleware token-device <agent>` | Generate OAuth token (device code) |
| `ms-middleware subscriptions [agent]` | List Graph subscriptions |
| `ms-middleware status` | Check if server is running |
| `ms-middleware install-service [name]` | Create systemd service |
| `ms-middleware help` | Show help |

---

## Required Azure AD Permissions

The Azure app registration needs these delegated permissions:
- `User.Read`
- `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`
- `Calendars.Read`, `Calendars.ReadWrite`
- `Chat.ReadWrite`, `ChatMessage.Send`
- `ChannelMessage.Send`
- `Files.Read.All`, `Files.ReadWrite.All`
- `Directory.Read.All`
- `Presence.Read`, `Presence.Read.All`
- `MailboxSettings.ReadWrite`
- `offline_access` (for refresh tokens)

---

*Last updated: 2026-03-19 by Max*
