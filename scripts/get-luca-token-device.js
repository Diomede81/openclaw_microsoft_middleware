#!/usr/bin/env node
/**
 * OAuth Token Generator for Luca (llicata@tulip-tech.com)
 * Uses device code flow - no redirect needed
 */

const fs = require('fs');
const path = require('path');

const CLIENT_ID = '79b3f60a-ddfe-4029-8af4-1c95a37c6aa7';
const TENANT_ID = '982780f8-0424-4e57-9cc0-bee3d6acc797';
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

async function main() {
  console.log('\n🔐 Luca Token Generator (Device Code Flow)');
  console.log('===========================================\n');
  
  // Step 1: Request device code
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
  
  const deviceCodeData = await deviceCodeResponse.json();
  
  if (deviceCodeData.error) {
    console.error('❌ Error:', deviceCodeData.error_description || deviceCodeData.error);
    process.exit(1);
  }
  
  console.log('📱 AUTHENTICATION REQUIRED\n');
  console.log('1. Open this URL in your browser:');
  console.log(`   ${deviceCodeData.verification_uri}\n`);
  console.log('2. Enter this code:');
  console.log(`   ${deviceCodeData.user_code}\n`);
  console.log('3. Sign in as: llicata@tulip-tech.com\n');
  console.log(`⏱️  Code expires in ${deviceCodeData.expires_in} seconds\n`);
  console.log('Waiting for authentication...\n');
  
  // Step 2: Poll for token
  const interval = deviceCodeData.interval * 1000 || 5000;
  const expiresAt = Date.now() + (deviceCodeData.expires_in * 1000);
  
  while (Date.now() < expiresAt) {
    await new Promise(resolve => setTimeout(resolve, interval));
    
    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: deviceCodeData.device_code
        })
      }
    );
    
    const tokenData = await tokenResponse.json();
    
    if (tokenData.error) {
      if (tokenData.error === 'authorization_pending') {
        process.stdout.write('.');
        continue;
      } else if (tokenData.error === 'authorization_declined') {
        console.error('\n\n❌ Authorization declined by user');
        process.exit(1);
      } else if (tokenData.error === 'expired_token') {
        console.error('\n\n❌ Device code expired');
        process.exit(1);
      } else {
        console.error('\n\n❌ Error:', tokenData.error_description || tokenData.error);
        process.exit(1);
      }
    }
    
    // Success! Save token
    tokenData.obtained_at = Date.now();
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2), { mode: 0o600 });
    
    // Verify who we authenticated as
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
  
  console.error('\n\n❌ Timeout waiting for authentication');
  process.exit(1);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
