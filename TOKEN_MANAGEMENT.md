# Token Management Guide

How the Microsoft middleware handles OAuth token refresh and security.

---

## Token Flow Overview

```
Initial Setup → Get Tokens → Store Tokens → Use & Auto-Refresh → Never Expire
```

---

## 1. Initial Token Acquisition

### Method A: Device Code Flow (Recommended for Development)

```javascript
const https = require('https');
const fs = require('fs');

const CLIENT_ID = 'your-client-id';
const TENANT_ID = 'your-tenant-id';
const SCOPES = 'https://graph.microsoft.com/.default offline_access';

// Step 1: Request device code
fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/devicecode`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: CLIENT_ID,
    scope: SCOPES
  })
})
.then(res => res.json())
.then(async (deviceCode) => {
  console.log('Go to:', deviceCode.verification_uri);
  console.log('Enter code:', deviceCode.user_code);
  
  // Step 2: Poll for token
  const interval = setInterval(async () => {
    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: deviceCode.device_code
        })
      }
    );
    
    const tokens = await tokenRes.json();
    
    if (tokens.access_token) {
      clearInterval(interval);
      
      // Save with obtained_at timestamp
      tokens.obtained_at = Date.now();
      
      fs.writeFileSync(
        'agent-microsoft-tokens.json',
        JSON.stringify(tokens, null, 2),
        { mode: 0o600 } // Restrict to owner only
      );
      
      console.log('✓ Tokens saved!');
      process.exit(0);
    } else if (tokens.error !== 'authorization_pending') {
      console.error('Error:', tokens.error_description);
      clearInterval(interval);
      process.exit(1);
    }
  }, deviceCode.interval * 1000);
});
```

### Method B: Authorization Code Flow (For Production)

See Azure documentation: https://docs.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-auth-code-flow

---

## 2. Token File Structure

```json
{
  "access_token": "eyJ0eXAiOiJKV1...",
  "refresh_token": "0.AXsA8I...",
  "token_type": "Bearer",
  "expires_in": 3599,
  "ext_expires_in": 3599,
  "scope": "Calendars.ReadWrite Mail.ReadWrite...",
  "obtained_at": 1710753600000
}
```

**Key Fields:**
- `access_token`: Short-lived token (1 hour)
- `refresh_token`: Long-lived token (90 days by default)
- `expires_in`: Seconds until access_token expires
- `obtained_at`: Unix timestamp when token was obtained

---

## 3. Automatic Token Refresh

### How It Works

The middleware uses **TWO refresh mechanisms** for reliability:

#### Mechanism 1: On-Demand Refresh (Reactive)

Checks on every API call:
- Calculate: `expiresAt = obtained_at + (expires_in * 1000)`
- Current time > `expiresAt - 5 minutes` → Refresh

#### Mechanism 2: Proactive Refresh Timer (Scheduled)

Independent timer checks all tokens every 30 minutes:
- Reads token file directly
- Calculates minutes until expiry
- Logs token status for each agent
- Refreshes if expiring within 10 minutes

**Why Both?**
- On-demand: Handles high-traffic scenarios
- Proactive: Ensures tokens stay fresh even during idle periods
- Redundancy: If one fails, the other catches it

2. **Proactive timer checks (every 30 minutes):**
   ```javascript
   // Read token file
   tokens = readTokenFile()
   expiresAt = tokens.obtained_at + (tokens.expires_in * 1000)
   minutesRemaining = (expiresAt - now) / 60000
   
   // Log status
   console.log(`Token valid for ${minutesRemaining} minutes`)
   
   // Refresh if expiring soon
   if (minutesRemaining < 10) {
     refreshToken()
   }
   ```

3. **Refresh process:**
   ```javascript
   POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
   
   Body:
   - client_id
   - client_secret (if confidential client)
   - refresh_token
   - grant_type: "refresh_token"
   - scope: "https://graph.microsoft.com/.default"
   ```

4. **Update token file atomically:**
   - Write to `.tmp` file first
   - Rename to actual file (atomic operation)
   - Prevents corruption if process crashes mid-write

### Security Features

✅ **5-minute buffer:** Refreshes before expiration  
✅ **Atomic writes:** Prevents file corruption  
✅ **Error handling:** Throws error if refresh fails (won't use expired token)  
✅ **File permissions:** Tokens saved with `0o600` (owner read/write only)  
✅ **Validation:** Checks for required fields before saving  
✅ **Logging:** Logs refresh attempts and success/failure  

### Code Implementation

```javascript
async function getAccessToken(agent) {
  // 1. Read tokens from file
  const tokens = JSON.parse(fs.readFileSync(config.tokenFile));
  
  // 2. Check if expired
  const expiresAt = tokens.obtained_at + (tokens.expires_in * 1000);
  const needsRefresh = Date.now() > expiresAt - 300000; // 5 min buffer
  
  if (!needsRefresh) {
    return tokens.access_token; // Still valid
  }
  
  // 3. Refresh token
  const response = await fetch('...', {
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret, // Optional
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
      scope: 'https://graph.microsoft.com/.default'
    })
  });
  
  const newTokens = await response.json();
  
  // 4. Validate response
  if (newTokens.error) {
    throw new Error(`Token refresh failed: ${newTokens.error_description}`);
  }
  
  // 5. Save atomically
  newTokens.obtained_at = Date.now();
  const tempFile = `${config.tokenFile}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(newTokens, null, 2), { mode: 0o600 });
  fs.renameSync(tempFile, config.tokenFile);
  
  return newTokens.access_token;
}
```

---

## 4. Client Types

### Public Client (No Secret)

- **Use case:** Desktop apps, mobile apps, scripts
- **Security:** Relies on refresh token rotation
- **Config:** Don't set `{AGENT}_CLIENT_SECRET`

Example:
```bash
MAX_CLIENT_ID=abc123
MAX_TENANT_ID=def456
# No CLIENT_SECRET
```

### Confidential Client (With Secret)

- **Use case:** Server applications, web services
- **Security:** Client secret + refresh token
- **Config:** Set `{AGENT}_CLIENT_SECRET`

Example:
```bash
MAX_CLIENT_ID=abc123
MAX_TENANT_ID=def456
MAX_CLIENT_SECRET=xyz789~secret~here
```

**Note:** Current deployment uses public client flow. For production, consider confidential clients with secrets stored in vault.

---

## 5. Refresh Token Rotation

Microsoft may issue **new refresh tokens** on each refresh:

```json
{
  "access_token": "new_access_token",
  "refresh_token": "NEW_refresh_token", // Changed!
  "expires_in": 3599
}
```

**Middleware handles this automatically** by saving the entire response, including new refresh tokens.

---

## 6. Token Expiration Scenarios

### Scenario 1: Access Token Expired
- **When:** 1 hour after `obtained_at`
- **Action:** Auto-refresh via `refresh_token`
- **User impact:** None (seamless)

### Scenario 2: Refresh Token Expired
- **When:** 90 days of inactivity (default Azure policy)
- **Action:** Refresh fails with error
- **User impact:** **Re-authentication required**
- **Fix:** Run token acquisition script again

### Scenario 3: User Revokes Access
- **When:** User revokes app permissions in Azure/M365
- **Action:** All API calls fail with 401
- **User impact:** **Re-authentication required**
- **Fix:** Re-authorize app, get new tokens

### Scenario 4: Password Changed
- **When:** User changes Microsoft password
- **Action:** Tokens usually remain valid (unless "Revoke all sessions" checked)
- **User impact:** May require re-authentication

---

## 7. Error Handling

### Token Refresh Failures

```javascript
try {
  const token = await getAccessToken('max');
} catch (error) {
  if (error.message.includes('refresh_token')) {
    // Refresh token expired or invalid
    console.error('Re-authentication required for max');
    // Alert admin, stop processing
  } else {
    // Network error or other issue
    console.error('Temporary token error:', error.message);
    // Retry or alert
  }
}
```

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `invalid_grant` | Refresh token expired | Re-authenticate |
| `invalid_client` | Wrong client_id | Check .env config |
| `unauthorized_client` | Missing permissions | Check Azure app permissions |
| `interaction_required` | MFA or policy change | User must sign in manually |

---

## 8. Monitoring Token Health

### Proactive Monitoring (Automatic)

The server logs token status every 30 minutes:

```bash
[max] Token valid for 31 minutes
[sophia] Token valid for 48 minutes
```

If expiring soon (< 10 min):
```bash
[max] Proactive token refresh (8 min remaining)...
[max] ✓ Token refreshed proactively
```

### Manual Checks

```bash
# Check token file exists and is readable
ls -l ~/clawd/*-microsoft-tokens.json

# Check current token expiry
node -e "
const tokens = require('./max-microsoft-tokens.json');
const expiresAt = new Date(tokens.obtained_at + tokens.expires_in * 1000);
console.log('Access token expires:', expiresAt);
console.log('Valid for:', Math.floor((expiresAt - Date.now()) / 60000), 'minutes');
"

# Watch token refresh logs in real-time
tail -f server.log | grep -E "Token valid|Token refresh"
```

### Server Logs - What to Look For

✅ **Good Signs:**
- `Token valid for X minutes` (logged every 30 min)
- `✓ Token refreshed successfully` (when refreshed)
- `✓ Token refreshed proactively` (proactive timer working)

⚠️ **Warning Signs:**
- `Token valid for 5 minutes` (expiring soon, watch for refresh)
- `Proactive token refresh (X min remaining)` (proactive refresh triggered)

❌ **Error Signs:**
- `Token refresh failed: invalid_grant` - Re-auth needed
- `Failed to read token file` - File missing or corrupted
- `Token expired X minutes ago` - Refresh failed, immediate action needed

---

## 9. Best Practices

✅ **Store tokens in secure location** (not in git)  
✅ **Use file permissions 0600** (owner read/write only)  
✅ **Monitor refresh failures** (alert on error)  
✅ **Document token acquisition** (how to re-auth)  
✅ **Test token refresh** (simulate expiry)  
✅ **Use confidential clients** in production (with secrets)  
✅ **Rotate client secrets** annually (if using)  
✅ **Keep backups** of token files (encrypted)  

❌ **Don't commit tokens to git**  
❌ **Don't log access tokens** (log refresh attempts only)  
❌ **Don't share token files** between agents  
❌ **Don't hardcode tokens** in code  

---

## 10. Troubleshooting

### "Token refresh failed: invalid_grant"

**Cause:** Refresh token expired (90 days of inactivity)  
**Fix:** Re-run token acquisition script:

```bash
node get-tokens.js
# Follow device code flow
# Save new tokens to {agent}-microsoft-tokens.json
systemctl --user restart microsoft-middleware
```

### "Failed to read token file"

**Cause:** File missing, corrupted, or wrong permissions  
**Fix:**

```bash
# Check file exists
ls -l /path/to/tokens.json

# Check permissions (should be -rw-------)
chmod 600 /path/to/tokens.json

# If corrupted, restore from backup or re-acquire
```

### Token refreshes but API calls still fail

**Cause:** Permissions revoked or insufficient scopes  
**Fix:**

1. Check Azure app permissions
2. Ensure all required scopes granted:
   - `Chat.ReadWrite`
   - `ChannelMessage.Read.All`
   - `Mail.ReadWrite`
   - `Calendars.ReadWrite`
3. Re-acquire tokens if scopes changed

---

## 11. Security Recommendations

### Production Deployment

1. **Use Azure Key Vault** for token storage
2. **Enable confidential client** with secret in vault
3. **Monitor token refresh patterns** (alert on failures)
4. **Implement token rotation** (proactive re-auth before 90 days)
5. **Use Managed Identity** if running on Azure
6. **Encrypt token files at rest** (dm-crypt, LUKS, etc.)

### Development

1. **Keep tokens in secure directory** (not in project root)
2. **Use .gitignore** to exclude tokens
3. **Document token acquisition** in README
4. **Test token refresh** before deployment

---

**Summary:** The middleware handles token refresh automatically with a 5-minute buffer, atomic file writes, and comprehensive error handling. Tokens rarely expire if the service runs continuously, but re-authentication is needed after 90 days of inactivity.
