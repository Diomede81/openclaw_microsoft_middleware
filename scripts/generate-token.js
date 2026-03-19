#!/usr/bin/env node
/**
 * OAuth Token Generator - Templated Version
 * Generates access token for Microsoft Graph API
 * 
 * Usage: 
 *   node generate-token.js                    # Uses .env defaults
 *   node generate-token.js --agent max        # Generate token for specific agent
 *   AGENT_NAME=kim node generate-token.js     # Via environment variable
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const http = require('http');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Parse command line args
const args = process.argv.slice(2);
let agentName = process.env.AGENT_NAME || process.env.DEFAULT_AGENT || 'max';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--agent' && args[i + 1]) {
    agentName = args[i + 1];
  }
}

agentName = agentName.toUpperCase();

// Load agent config from environment
const CLIENT_ID = process.env[`${agentName}_CLIENT_ID`];
const TENANT_ID = process.env[`${agentName}_TENANT_ID`];
const TOKEN_FILE = process.env[`${agentName}_TOKEN_FILE`];
const DISPLAY_NAME = process.env[`${agentName}_DISPLAY_NAME`] || agentName;
const OAUTH_PORT = parseInt(process.env.OAUTH_CALLBACK_PORT || '3001', 10);
const REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || `http://localhost:${OAUTH_PORT}/oauth/callback`;

// Validate required config
if (!CLIENT_ID || !TENANT_ID || !TOKEN_FILE) {
  console.error(`\n❌ Missing configuration for agent: ${agentName}`);
  console.error('\nRequired environment variables:');
  console.error(`  ${agentName}_CLIENT_ID`);
  console.error(`  ${agentName}_TENANT_ID`);
  console.error(`  ${agentName}_TOKEN_FILE`);
  console.error('\nEither set these in .env or pass --agent <name>\n');
  process.exit(1);
}

const SCOPES = (process.env.OAUTH_SCOPES || [
  'User.Read',
  'Mail.Read',
  'Mail.ReadWrite',
  'Mail.Send',
  'Calendars.Read',
  'Calendars.ReadWrite',
  'Chat.ReadWrite',
  'ChatMessage.Send',
  'ChannelMessage.Send',
  'Files.Read.All',
  'Files.ReadWrite.All',
  'Sites.Read.All',
  'Directory.Read.All',
  'Presence.Read',
  'Presence.Read.All',
  'Presence.ReadWrite',
  'MailboxSettings.ReadWrite',
  'offline_access'
].join(' '));

// Authorization URL
const authUrl = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize?` +
  `client_id=${CLIENT_ID}&` +
  `response_type=code&` +
  `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
  `response_mode=query&` +
  `scope=${encodeURIComponent(SCOPES)}&` +
  `state=12345`;

console.log(`\n🔐 Token Generator for ${DISPLAY_NAME}`);
console.log('='.repeat(30 + DISPLAY_NAME.length) + '\n');
console.log(`Agent: ${agentName}`);
console.log(`Client ID: ${CLIENT_ID.substring(0, 8)}...`);
console.log(`Tenant ID: ${TENANT_ID.substring(0, 8)}...`);
console.log(`Token File: ${TOKEN_FILE}\n`);
console.log('Opening browser for authentication...\n');

// Start local server to catch redirect
const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/oauth/callback')) {
    const url = new URL(req.url, `http://localhost:${OAUTH_PORT}`);
    const code = url.searchParams.get('code');
    
    if (!code) {
      res.writeHead(400);
      res.end('Error: No authorization code received');
      server.close();
      return;
    }
    
    try {
      // Exchange code for token
      const tokenResponse = await fetch(
        `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: CLIENT_ID,
            scope: SCOPES,
            code: code,
            redirect_uri: REDIRECT_URI,
            grant_type: 'authorization_code'
          })
        }
      );
      
      const tokenData = await tokenResponse.json();
      
      if (tokenData.error) {
        throw new Error(`Token error: ${tokenData.error_description || tokenData.error}`);
      }
      
      // Add metadata
      tokenData.obtained_at = Date.now();
      tokenData.agent = agentName.toLowerCase();
      
      // Ensure directory exists
      const tokenDir = path.dirname(TOKEN_FILE);
      if (!fs.existsSync(tokenDir)) {
        fs.mkdirSync(tokenDir, { recursive: true });
      }
      
      // Save token
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2), { mode: 0o600 });
      
      // Verify who we authenticated as
      const userResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
      });
      const userData = await userResponse.json();
      
      console.log('\n✅ Success!');
      console.log('===========\n');
      console.log(`Authenticated as: ${userData.displayName || 'Unknown'}`);
      console.log(`Email: ${userData.userPrincipalName || 'Unknown'}`);
      console.log(`Token saved to: ${TOKEN_FILE}\n`);
      
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Authentication Successful</title></head>
        <body style="font-family: system-ui; max-width: 600px; margin: 100px auto; text-align: center;">
          <h1 style="color: green;">✅ Authentication Successful!</h1>
          <p><strong>Agent:</strong> ${DISPLAY_NAME}</p>
          <p><strong>User:</strong> ${userData.displayName}</p>
          <p><strong>Email:</strong> ${userData.userPrincipalName}</p>
          <p>Token saved to:<br><code>${TOKEN_FILE}</code></p>
          <p style="color: #666; margin-top: 40px;">You can close this window now.</p>
        </body>
        </html>
      `);
      
      setTimeout(() => server.close(), 1000);
      
    } catch (error) {
      console.error('\n❌ Error:', error.message);
      res.writeHead(500);
      res.end(`Error: ${error.message}`);
      server.close();
    }
  }
});

server.listen(OAUTH_PORT, () => {
  console.log(`Local server listening on http://localhost:${OAUTH_PORT}\n`);
  
  // Open browser
  const openCommand = process.platform === 'darwin' ? 'open' : 
                      process.platform === 'win32' ? 'start' : 'xdg-open';
  
  exec(`${openCommand} "${authUrl}"`, (error) => {
    if (error) {
      console.log('Could not open browser automatically. Please visit:\n');
      console.log(authUrl);
      console.log('\n');
    }
  });
});

server.on('close', () => {
  console.log('\nServer closed.');
  process.exit(0);
});
