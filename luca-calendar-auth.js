const fs = require('fs');
const TENANT_ID = '982780f8-0424-4e57-9cc0-bee3d6acc797';
const CLIENT_ID = '79b3f60a-ddfe-4029-8af4-1c95a37c6aa7';
const { writeSecret } = require('./scripts/age-secrets');
const SECRET_FILE = 'luca-calendar-tokens.json.age';

async function deviceCodeAuth() {
  // Request device code - ONLY calendar permissions
  const codeResponse = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/devicecode`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        scope: 'Calendars.ReadWrite offline_access'
      })
    }
  );
  
  const codeData = await codeResponse.json();
  if (codeData.error) {
    console.error('Error:', codeData.error_description);
    return;
  }
  
  console.log('\n========================================');
  console.log('CALENDAR-ONLY ACCESS');
  console.log('========================================');
  console.log(`\nGo to: ${codeData.verification_uri}`);
  console.log(`Enter code: ${codeData.user_code}`);
  console.log(`\nSign in as: llicata@tulip-tech.com`);
  console.log('\nWaiting for authorization...\n');
  
  // Poll for token
  const interval = codeData.interval * 1000;
  const expiresAt = Date.now() + (codeData.expires_in * 1000);
  
  while (Date.now() < expiresAt) {
    await new Promise(r => setTimeout(r, interval));
    
    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: codeData.device_code
        })
      }
    );
    
    const tokenData = await tokenResponse.json();
    
    if (tokenData.access_token) {
      tokenData.obtained_at = Date.now();
      tokenData.email = 'llicata@tulip-tech.com';
      writeSecret(SECRET_FILE, tokenData);
      console.log('✅ Calendar access granted!');
      console.log('Tokens encrypted and saved');
      return;
    }
    
    if (tokenData.error && tokenData.error !== 'authorization_pending') {
      console.error('Error:', tokenData.error_description);
      return;
    }
    
    process.stdout.write('.');
  }
  
  console.log('\nAuthorization timed out.');
}

deviceCodeAuth();
