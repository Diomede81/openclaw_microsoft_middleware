#!/usr/bin/env node
/**
 * Debug Last Message - Templated Version
 * Fetch and display the most recent Teams/Email message for debugging
 * 
 * Usage:
 *   node debug-last-message.js --agent max --type teams
 *   node debug-last-message.js --agent kim --type email
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

// Parse command line args
const args = process.argv.slice(2);
let agentName = process.env.DEFAULT_AGENT || 'max';
let messageType = 'teams';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--agent' && args[i + 1]) {
    agentName = args[i + 1];
  }
  if (args[i] === '--type' && args[i + 1]) {
    messageType = args[i + 1];
  }
}

agentName = agentName.toUpperCase();

// Load agent config from environment
const CLIENT_ID = process.env[`${agentName}_CLIENT_ID`];
const TENANT_ID = process.env[`${agentName}_TENANT_ID`];
const TOKEN_FILE = process.env[`${agentName}_TOKEN_FILE`];

// Validate required config
if (!CLIENT_ID || !TENANT_ID || !TOKEN_FILE) {
  console.error(`\n❌ Missing configuration for agent: ${agentName}`);
  process.exit(1);
}

async function getAccessToken() {
  if (!fs.existsSync(TOKEN_FILE)) {
    throw new Error(`Token file not found: ${TOKEN_FILE}`);
  }
  
  let tokenData = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  
  // Check if token needs refresh
  const expiresAt = (tokenData.obtained_at || 0) + ((tokenData.expires_in || 3600) * 1000);
  if (Date.now() > expiresAt - 300000) {
    const response = await fetch(
      `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          grant_type: 'refresh_token',
          refresh_token: tokenData.refresh_token,
          scope: tokenData.scope || 'https://graph.microsoft.com/.default offline_access'
        })
      }
    );
    tokenData = await response.json();
    if (!tokenData.access_token) {
      throw new Error(`Token refresh failed: ${tokenData.error_description || tokenData.error}`);
    }
    tokenData.obtained_at = Date.now();
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2), { mode: 0o600 });
  }
  
  return tokenData.access_token;
}

async function debugTeams(accessToken) {
  console.log('\n🔍 Fetching recent Teams chats...\n');
  
  // Get chats
  const chatsResponse = await fetch(
    'https://graph.microsoft.com/v1.0/me/chats?$top=5&$orderby=lastMessagePreview/createdDateTime desc',
    { headers: { 'Authorization': `Bearer ${accessToken}` } }
  );
  
  const chats = await chatsResponse.json();
  
  if (chats.error) {
    console.error('Error:', chats.error.message);
    return;
  }
  
  if (!chats.value || chats.value.length === 0) {
    console.log('No chats found');
    return;
  }
  
  // Get messages from first chat
  const chat = chats.value[0];
  console.log(`Chat: ${chat.topic || chat.chatType} (${chat.id})\n`);
  
  const messagesResponse = await fetch(
    `https://graph.microsoft.com/v1.0/me/chats/${chat.id}/messages?$top=3`,
    { headers: { 'Authorization': `Bearer ${accessToken}` } }
  );
  
  const messages = await messagesResponse.json();
  
  if (messages.value) {
    for (const msg of messages.value) {
      console.log('─'.repeat(50));
      console.log(`From: ${msg.from?.user?.displayName || 'Unknown'}`);
      console.log(`Time: ${msg.createdDateTime}`);
      console.log(`Content: ${msg.body?.content?.substring(0, 200) || '(no content)'}...`);
    }
  }
}

async function debugEmail(accessToken) {
  console.log('\n🔍 Fetching recent emails...\n');
  
  const response = await fetch(
    'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=3&$orderby=receivedDateTime desc',
    { headers: { 'Authorization': `Bearer ${accessToken}` } }
  );
  
  const emails = await response.json();
  
  if (emails.error) {
    console.error('Error:', emails.error.message);
    return;
  }
  
  if (!emails.value || emails.value.length === 0) {
    console.log('No emails found');
    return;
  }
  
  for (const email of emails.value) {
    console.log('─'.repeat(50));
    console.log(`From: ${email.from?.emailAddress?.name} <${email.from?.emailAddress?.address}>`);
    console.log(`Subject: ${email.subject}`);
    console.log(`Time: ${email.receivedDateTime}`);
    console.log(`Preview: ${email.bodyPreview?.substring(0, 100)}...`);
  }
}

async function main() {
  console.log(`\n🔧 Debug Last Message - ${agentName}`);
  console.log('='.repeat(40));
  
  const accessToken = await getAccessToken();
  
  if (messageType === 'teams') {
    await debugTeams(accessToken);
  } else if (messageType === 'email') {
    await debugEmail(accessToken);
  } else {
    console.error(`Unknown message type: ${messageType}`);
    console.error('Valid types: teams, email');
    process.exit(1);
  }
  
  console.log('\n');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
