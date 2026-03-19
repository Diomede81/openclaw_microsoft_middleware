#!/usr/bin/env node
/**
 * OAuth Token Generator for Luca (llicata@tulip-tech.com)
 * Generates access token for Microsoft Graph API
 */

const http = require('http');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const CLIENT_ID = '79b3f60a-ddfe-4029-8af4-1c95a37c6aa7'; // Clawdbot Integration app
const TENANT_ID = '982780f8-0424-4e57-9cc0-bee3d6acc797'; // tulip-tech.com tenant
const REDIRECT_URI = 'http://localhost:3001/oauth/callback';
const TOKEN_FILE = path.join(process.env.HOME, 'clawd', 'luca-microsoft-tokens.json');

const SCOPES = [
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
].join(' ');

// Authorization URL
const authUrl = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize?` +
  `client_id=${CLIENT_ID}&` +
  `response_type=code&` +
  `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
  `response_mode=query&` +
  `scope=${encodeURIComponent(SCOPES)}&` +
  `state=12345`;

console.log('\n🔐 Luca Token Generator');
console.log('========================\n');
console.log('This will authenticate you (llicata@tulip-tech.com) and save your token.\n');
console.log('Opening browser for authentication...\n');

// Start local server to catch redirect
const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/oauth/callback')) {
    const url = new URL(req.url, `http://localhost:3001`);
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
      
      // Add timestamp
      tokenData.obtained_at = Date.now();
      
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

server.listen(3001, () => {
  console.log('Local server listening on http://localhost:3001\n');
  
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
