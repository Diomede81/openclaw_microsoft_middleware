#!/usr/bin/env node
/**
 * OAuth Device Code Token Generator - Templated Version
 * For headless/CLI environments without browser access
 * 
 * Usage: 
 *   ms-middleware token-device <agent>               # Via CLI
 *   node generate-token-device.js --agent max        # Direct invocation
 *   AGENT_NAME=kim node generate-token-device.js    # Via environment variable
 */

const path = require('path');
const fs = require('fs');

// Load .env from cwd first, then package directory
const cwdEnv = path.join(process.cwd(), '.env');
const pkgEnv = path.join(__dirname, '..', '.env');
if (fs.existsSync(cwdEnv)) {
  require('dotenv').config({ path: cwdEnv });
} else if (fs.existsSync(pkgEnv)) {
  require('dotenv').config({ path: pkgEnv });
}

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

async function main() {
  console.log(`\n🔐 Device Code Token Generator for ${DISPLAY_NAME}`);
  console.log('='.repeat(40 + DISPLAY_NAME.length) + '\n');
  console.log(`Agent: ${agentName}`);
  console.log(`Client ID: ${CLIENT_ID.substring(0, 8)}...`);
  console.log(`Tenant ID: ${TENANT_ID.substring(0, 8)}...`);
  console.log(`Token File: ${TOKEN_FILE}\n`);
  
  // Step 1: Request device code
  console.log('Requesting device code...\n');
  
  const deviceCodeResponse = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/devicecode`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        scope: SCOPES
      })
    }
  );
  
  const deviceCode = await deviceCodeResponse.json();
  
  if (deviceCode.error) {
    console.error('❌ Error:', deviceCode.error_description || deviceCode.error);
    process.exit(1);
  }
  
  console.log('📱 Device Code Flow');
  console.log('==================\n');
  console.log('1. Go to:', deviceCode.verification_uri);
  console.log('2. Enter code:', deviceCode.user_code);
  console.log(`3. Sign in with the ${DISPLAY_NAME} account\n`);
  console.log('Waiting for authentication...\n');
  
  // Step 2: Poll for token
  const interval = deviceCode.interval * 1000 || 5000;
  const expiresAt = Date.now() + (deviceCode.expires_in * 1000);
  
  while (Date.now() < expiresAt) {
    await new Promise(resolve => setTimeout(resolve, interval));
    
    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: CLIENT_ID,
          device_code: deviceCode.device_code
        })
      }
    );
    
    const tokenData = await tokenResponse.json();
    
    if (tokenData.error === 'authorization_pending') {
      process.stdout.write('.');
      continue;
    }
    
    if (tokenData.error) {
      console.error('\n❌ Error:', tokenData.error_description || tokenData.error);
      process.exit(1);
    }
    
    // Success - save token
    tokenData.obtained_at = Date.now();
    tokenData.agent = agentName.toLowerCase();
    
    // Ensure directory exists
    const tokenDir = path.dirname(TOKEN_FILE);
    if (!fs.existsSync(tokenDir)) {
      fs.mkdirSync(tokenDir, { recursive: true });
    }
    
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2), { mode: 0o600 });
    
    // Get user info
    const userResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });
    const userData = await userResponse.json();
    
    console.log('\n\n✅ Success!');
    console.log('===========\n');
    console.log(`Authenticated as: ${userData.displayName || 'Unknown'}`);
    console.log(`Email: ${userData.userPrincipalName || 'Unknown'}`);
    console.log(`Token saved to: ${TOKEN_FILE}\n`);
    process.exit(0);
  }
  
  console.log('\n❌ Authentication timed out. Please try again.\n');
  process.exit(1);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
