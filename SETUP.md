# Setup Guide - Microsoft Integration

Complete guide to set up Microsoft 365 integration for OpenClaw agents.

## Prerequisites

1. **Azure App Registration** for each Microsoft 365 tenant
2. **Microsoft OAuth tokens** for each agent
3. **OpenClaw gateway** running with webhook endpoint
4. **Cloudflare tunnel** (or ngrok) for webhook delivery

---

## Step 1: Azure App Registration

For each Microsoft tenant (e.g., Max's work tenant, Sophia's work tenant):

### 1.1 Create App Registration

1. Go to https://portal.azure.com
2. Navigate to **Azure Active Directory** → **App registrations**
3. Click **New registration**
4. Name: `OpenClaw Microsoft Integration`
5. Supported account types: **Single tenant**
6. Redirect URI: Leave blank for now
7. Click **Register**

### 1.2 Note Client ID and Tenant ID

From the app overview page:
- **Application (client) ID**: Copy this → `{AGENT}_CLIENT_ID`
- **Directory (tenant) ID**: Copy this → `{AGENT}_TENANT_ID`

### 1.3 Create Client Secret

1. Go to **Certificates & secrets** → **Client secrets**
2. Click **New client secret**
3. Description: `OpenClaw`
4. Expires: **24 months**
5. Copy the **Value** (not the Secret ID)

### 1.4 Configure API Permissions

1. Go to **API permissions**
2. Click **Add a permission** → **Microsoft Graph** → **Delegated permissions**
3. Add these permissions:
   - `Chat.ReadWrite` - Read and send Teams messages
   - `ChannelMessage.Read.All` - Read Teams channel messages
   - `ChannelMessage.Send` - Send Teams channel messages
   - `Mail.ReadWrite` - Read and send emails
   - `Mail.Send` - Send emails
   - `Calendars.ReadWrite` - Read and write calendar
   - `User.Read` - Read user profile (for display name/user ID)
4. Click **Grant admin consent** (requires admin)

---

## Step 2: Get OAuth Tokens

### Option A: Device Code Flow (Recommended)

1. Create a script to get tokens:

```javascript
const https = require('https');
const readline = require('readline');

const CLIENT_ID = 'your-client-id';
const TENANT_ID = 'your-tenant-id';
const SCOPES = 'https://graph.microsoft.com/.default offline_access';

// Step 1: Request device code
const deviceCodeData = JSON.stringify({
  client_id: CLIENT_ID,
  scope: SCOPES
});

const deviceCodeReq = https.request({
  hostname: 'login.microsoftonline.com',
  path: `/${TENANT_ID}/oauth2/v2.0/devicecode`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': deviceCodeData.length
  }
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    const response = JSON.parse(body);
    console.log('Go to:', response.verification_uri);
    console.log('Enter code:', response.user_code);
    
    // Poll for token...
  });
});

deviceCodeReq.write(deviceCodeData);
deviceCodeReq.end();
```

2. Run script and follow instructions
3. Save tokens to `{agent}-microsoft-tokens.json`

---

## Step 3: Configure Environment

### 3.1 Copy template

```bash
cd microsoft-middleware
cp .env.example .env
```

### 3.2 Fill in agent details

For each agent, add:

```bash
# Agent: Max
MAX_CLIENT_ID=your-azure-client-id
MAX_TENANT_ID=your-azure-tenant-id
MAX_TOKEN_FILE=/absolute/path/to/max-microsoft-tokens.json
MAX_GATEWAY_URL=http://localhost:18789/hooks/agent
MAX_GATEWAY_TOKEN=your-openclaw-gateway-token
MAX_DISPLAY_NAME=Max Ferretti
MAX_AGENT_ID=max
```

**Important:**
- `TOKEN_FILE` must be absolute path
- `GATEWAY_URL` must point to OpenClaw gateway webhook
- `GATEWAY_TOKEN` is from OpenClaw config
- `DISPLAY_NAME` must match exact Teams display name

### 3.3 Update subscriptions config

Edit `config/subscriptions.json`:

```json
{
  "max": [
    {
      "resource": "/me/chats/getAllMessages",
      "changeType": "created",
      "notificationUrl": "https://your-domain.com/webhook/teams/max",
      "clientState": "max-teams",
      "maxExpirationMinutes": 60
    },
    {
      "resource": "/me/messages",
      "changeType": "created",
      "notificationUrl": "https://your-domain.com/webhook/email/max",
      "clientState": "max-email",
      "maxExpirationMinutes": 4320
    }
  ]
}
```

Replace `your-domain.com` with your Cloudflare tunnel domain.

---

## Step 4: Set Up Webhook Tunnel

### Option A: Cloudflare Tunnel (Recommended)

1. Install cloudflared:
```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared
```

2. Authenticate:
```bash
./cloudflared tunnel login
```

3. Create tunnel:
```bash
./cloudflared tunnel create microsoft-integration
```

4. Configure routing:
```bash
./cloudflared tunnel route dns microsoft-integration microsoft.yourdomain.com
```

5. Create config file `~/.cloudflared/config.yml`:
```yaml
tunnel: your-tunnel-id
credentials-file: /path/to/credentials.json

ingress:
  - hostname: microsoft.yourdomain.com
    service: http://localhost:3007
  - service: http_status:404
```

6. Run tunnel:
```bash
./cloudflared tunnel run microsoft-integration
```

### Option B: ngrok

```bash
ngrok http 3007
# Use the https URL in subscriptions.json
```

---

## Step 5: Start Server

### Development

```bash
npm install
npm run dev
```

### Production (systemd)

1. Create service file `~/.config/systemd/user/microsoft-middleware.service`:

```ini
[Unit]
Description=Microsoft Middleware Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/microsoft-middleware
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
StandardOutput=append:/path/to/server.log
StandardError=append:/path/to/server.log

[Install]
WantedBy=default.target
```

2. Enable and start:

```bash
systemctl --user daemon-reload
systemctl --user enable microsoft-middleware
systemctl --user start microsoft-middleware
```

3. Check status:

```bash
systemctl --user status microsoft-middleware
```

---

## Step 6: Test

### 6.1 Health check

```bash
curl http://localhost:3007/health
# Should return: {"status":"ok","agents":["max","sophia"]}
```

### 6.2 Create test subscription

```bash
node tools/create-test-subscription.js
```

### 6.3 Send test message

1. **1:1 chat test:** Send message to agent on Teams (should get response)
2. **Group chat test (no mention):** Send message in group (should be ignored)
3. **Group chat test (with mention):** @mention agent in group (should get response)

### 6.4 Check logs

```bash
tail -f server.log
```

Look for:
- `[agent] Fetched user ID: ...` (startup)
- `[agent] [1:1] Teams message from ...` (1:1 message)
- `[agent] 🎯 Group chat message where I'm @mentioned!` (@mention in group)
- `[agent] Skipping group chat message (not @mentioned)` (ignored group message)

---

## Troubleshooting

### Issue: "Fetched user ID" not showing

**Cause:** Token file invalid or missing permissions  
**Fix:** Re-generate tokens with correct scopes

### Issue: Webhooks not received

**Cause:** Tunnel not routing correctly  
**Fix:** 
1. Check tunnel is running
2. Verify public URL matches subscriptions.json
3. Test webhook URL: `curl https://your-domain.com/webhook/teams/max?validationToken=test`

### Issue: Group messages not detected

**Cause:** Display name mismatch  
**Fix:** Check logs for "Fetched user ID" - verify display name matches Teams exactly

### Issue: "Skipping old message"

**Cause:** Server restart processes backfill  
**Fix:** This is normal - old messages are filtered out automatically

---

## Utility Scripts

### List all subscriptions

```bash
node tools/list-all-subscriptions.js
```

### Delete all subscriptions

```bash
node tools/list-all-subscriptions.js delete
```

### Debug last message

```bash
node tools/debug-last-message.js
```

---

## Security Notes

- Never commit `.env` to git
- Store tokens in secure location (use encryption at rest if possible)
- Rotate client secrets annually
- Use principle of least privilege for API permissions
- Monitor logs for suspicious activity

---

## Next Steps

1. Monitor logs for first 24 hours
2. Test all filter scenarios
3. Add more agents by duplicating env pattern
4. Set up alerts for subscription failures
5. Configure auto-restart on crashes

---

**Questions?** Check the main README or logs first.
