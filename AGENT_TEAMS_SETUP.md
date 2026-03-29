# Setting Up Teams Integration for OpenClaw Agents

This guide explains how to configure a new OpenClaw agent to receive and respond to Microsoft Teams messages using the Microsoft Middleware.

## Architecture Overview

```
Microsoft Graph API
        │
        ▼ (webhooks)
┌───────────────────┐
│  Microsoft        │
│  Middleware       │  ← Receives Teams/Email/Calendar webhooks
│  (port 3007)      │
└───────────────────┘
        │
        ▼ (POST /hooks/agent)
┌───────────────────┐
│  OpenClaw         │
│  Gateway          │  ← Processes message, runs agent
│  (agent hooks)    │
└───────────────────┘
        │
        ▼ (agent calls API)
┌───────────────────┐
│  Middleware       │
│  POST /api/reply  │  ← Sends reply via Graph API
└───────────────────┘
```

**Key Change (v1.1.0+):** Agents now use the middleware's `/api/reply/:agent` endpoint instead of custom scripts. This is plug-and-play with no per-agent setup needed.

## Prerequisites

1. **Microsoft Middleware** installed and running (see `AGENT_INSTALL_GUIDE.md`)
2. **Azure AD App Registration** for the agent with:
   - `Chat.ReadWrite`
   - `ChatMessage.Send`
   - `User.Read`
   - `offline_access`
3. **Microsoft OAuth token** for the agent
4. **OpenClaw gateway** running for the agent

## Step-by-Step Setup

### 1. Configure Middleware for the Agent

Add the agent to the middleware `.env` file:

```env
# Add to ENABLED_AGENTS
ENABLED_AGENTS=max,sophia,newagent

# Add agent configuration block
NEWAGENT_CLIENT_ID=<azure-client-id>
NEWAGENT_TENANT_ID=<azure-tenant-id>
NEWAGENT_TOKEN_FILE=/path/to/newagent-microsoft-tokens.json
NEWAGENT_GATEWAY_URL=http://localhost:<agent-gateway-port>/hooks/agent
NEWAGENT_GATEWAY_TOKEN=<agent-hooks-token>
NEWAGENT_DISPLAY_NAME=New Agent
NEWAGENT_AGENT_ID=newagent
```

Restart the middleware:
```bash
systemctl --user restart microsoft-middleware
```

### 2. Generate Microsoft OAuth Token

```bash
cd ~/microsoft-middleware
ms-middleware token newagent
# Or for headless:
ms-middleware token-device newagent
```

This creates the token file at the path specified in `NEWAGENT_TOKEN_FILE`.

### 3. Configure Agent Gateway Hooks

Add to the agent's OpenClaw config (`~/.openclaw-newagent/openclaw.json`):

```json
{
  "hooks": {
    "enabled": true,
    "path": "/hooks",
    "token": "<agent-hooks-token>",
    "defaultSessionKey": "agent:newagent:main",
    "allowRequestSessionKey": true,
    "allowedSessionKeyPrefixes": ["hook:", "agent:"],
    "allowedAgentIds": ["*"]
  }
}
```

The `token` must match `NEWAGENT_GATEWAY_TOKEN` in the middleware `.env`.

### 4. Configure Agent to Reply on Teams

**Option A: Using Middleware API (Recommended - v1.1.0+)**

Add to agent's `TOOLS.md` or `workspace/README.md`:

```markdown
## Microsoft Teams Reply

When you receive a Teams message, the chatId is provided in the webhook.

To reply:
```bash
curl -X POST "http://localhost:3007/api/reply/<agent-name>" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": "<chatId-from-webhook>",
    "message": "<p>Your HTML reply</p>"
  }'
```

Example:
```bash
curl -X POST "http://localhost:3007/api/reply/newagent" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": "19:xxx@unq.gbl.spaces",
    "message": "<p>Hello! I received your message.</p>"
  }'
```

**Benefits:**
- ✅ No custom scripts needed
- ✅ Middleware handles token management
- ✅ Replies stored in session history automatically
- ✅ Works for any agent configured in middleware

**Option B: Custom Reply Script (Legacy)**

If you need a custom script (for special logic), create `<workspace>/newagent-teams-reply.js`:

```javascript
#!/usr/bin/env node
/**
 * NewAgent Teams - Send message to a chat
 * Usage: node newagent-teams-reply.js '<chatId>' '<message>'
 */

const fs = require('fs');

const TOKEN_FILE = '/path/to/newagent-microsoft-tokens.json';
const CONFIG = {
  clientId: '<azure-client-id>',
  tenantId: '<azure-tenant-id>'
};

async function refreshToken() {
  const tokens = JSON.parse(fs.readFileSync(TOKEN_FILE));
  
  const response = await fetch(
    `https://login.microsoftonline.com/${CONFIG.tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CONFIG.clientId,
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        scope: 'https://graph.microsoft.com/Chat.ReadWrite https://graph.microsoft.com/User.Read offline_access'
      })
    }
  );
  
  const newTokens = await response.json();
  if (newTokens.error) throw new Error(newTokens.error_description);
  
  newTokens.obtained_at = Date.now();
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(newTokens, null, 2));
  return newTokens.access_token;
}

async function sendMessage(chatId, message) {
  const accessToken = await refreshToken();
  
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/me/chats/${chatId}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        body: { contentType: 'html', content: message }
      })
    }
  );
  
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || 'Failed to send message');
  }
  
  console.log('Message sent successfully');
}

const [,, chatId, message] = process.argv;
if (!chatId || !message) {
  console.error('Usage: node newagent-teams-reply.js <chatId> <message>');
  process.exit(1);
}

sendMessage(chatId, message).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
```

Make it executable:
```bash
chmod +x <workspace>/newagent-teams-reply.js
```

### 5. Update Agent's TOOLS.md

Add to the agent's `TOOLS.md`:

```markdown
## Teams Reply
```bash
node ~/workspace/newagent-teams-reply.js '<chatId>' '<HTML message>'
```

Use this to reply to Teams messages. The chatId is provided in the incoming webhook context.
```

### 6. Disable Unused Plugins (Optional)

If the agent had the `msteams` plugin enabled, disable it since the middleware handles everything:

```json
{
  "plugins": {
    "entries": {
      "msteams": {
        "enabled": false
      }
    }
  }
}
```

## Testing

1. **Check middleware is forwarding:**
   ```bash
   journalctl --user -u microsoft-middleware --since "5 min ago" | grep newagent
   ```

2. **Check gateway receives hooks:**
   ```bash
   journalctl --user -u openclaw-gateway-newagent --since "5 min ago" | grep hooks
   ```

3. **Send a test Teams message** to the agent and verify:
   - Middleware logs show `Forwarding to...`
   - Middleware logs show `Gateway response: {"ok":true,...}`
   - Agent responds on Teams

## Troubleshooting

### Agent not receiving messages

1. Check middleware `.env` has correct `NEWAGENT_GATEWAY_URL` and `NEWAGENT_GATEWAY_TOKEN`
2. Verify hooks are enabled in agent's OpenClaw config
3. Check gateway is running: `systemctl --user status openclaw-gateway-newagent`

### Agent receives but doesn't reply

1. Verify Teams reply script path in TOOLS.md
2. Check token file exists and is readable
3. Test script manually:
   ```bash
   node newagent-teams-reply.js '<test-chat-id>' 'Test message'
   ```

### Token refresh errors

1. Regenerate token: `ms-middleware token newagent`
2. Verify Azure app has correct permissions
3. Check token file permissions (should be readable by agent process)

### Webhook subscription errors

1. Check middleware logs for subscription errors
2. Verify `PUBLIC_URL` in middleware `.env` is correct and accessible
3. Microsoft Graph webhooks require HTTPS with valid certificate

## Summary Checklist

- [ ] Agent added to middleware `.env` with correct credentials
- [ ] OAuth token generated for agent
- [ ] Agent gateway hooks configured with matching token
- [ ] TOOLS.md updated with `/api/reply/:agent` endpoint documentation
- [ ] msteams plugin disabled (if previously enabled)
- [ ] Middleware restarted after config changes
- [ ] Agent gateway restarted after config changes
- [ ] End-to-end test successful (send Teams message → agent replies)

---

*Last updated: 2026-03-19*
