#!/usr/bin/env node
const fs = require('fs');

const CLIENT_ID = '79b3f60a-ddfe-4029-8af4-1c95a37c6aa7';
const TENANT_ID = '982780f8-0424-4e57-9cc0-bee3d6acc797';
// Calendar permissions only - NO Chat
const SCOPES = 'offline_access Mail.Read Mail.Send Mail.ReadWrite User.Read Calendars.Read Calendars.ReadWrite';
const TOKEN_FILE = '/home/lucalicata/clawd/max-microsoft-tokens.json';

async function main() {
  console.log('\n🤖 Max - Calendar Auth (NO Chat)\n');
  console.log('Scopes:', SCOPES);
  
  const dcRes = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/devicecode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `client_id=${CLIENT_ID}&scope=${encodeURIComponent(SCOPES)}`
  });
  const dc = await dcRes.json();
  
  if (dc.error) { console.error('Error:', dc.error_description); process.exit(1); }
  
  console.log('📱 Go to:', dc.verification_uri);
  console.log('📝 Code:', dc.user_code);
  console.log('\nWaiting...\n');
  
  const interval = (dc.interval || 5) * 1000;
  const expires = Date.now() + dc.expires_in * 1000;
  
  while (Date.now() < expires) {
    await new Promise(r => setTimeout(r, interval));
    
    const tokenRes = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=${CLIENT_ID}&grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code=${encodeURIComponent(dc.device_code)}`
    });
    
    const tokens = await tokenRes.json();
    
    if (tokens.error === 'authorization_pending') {
      process.stdout.write('.');
      continue;
    }
    
    if (tokens.error) {
      console.error('\nError:', tokens.error, tokens.error_description);
      process.exit(1);
    }
    
    tokens.obtained_at = Date.now();
    tokens.email = 'max@tulip-tech.com';
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
    
    console.log('\n\n✅ SUCCESS!');
    console.log('Scopes granted:', tokens.scope);
    process.exit(0);
  }
  
  console.log('\n❌ Timeout');
  process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
