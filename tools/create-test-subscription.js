#!/usr/bin/env node
/**
 * Create a single test Teams subscription for Max
 * For isolated 1:1 chat testing
 */

const fs = require('fs');

const CONFIG = {
  clientId: '79b3f60a-ddfe-4029-8af4-1c95a37c6aa7',
  tenantId: '982780f8-0424-4e57-9cc0-bee3d6acc797',
  tokenFile: '/home/lucalicata/clawd/max-microsoft-tokens.json'
};

async function getAccessToken() {
  const tokens = JSON.parse(fs.readFileSync(CONFIG.tokenFile, 'utf8'));
  const expiresAt = tokens.obtained_at + (tokens.expires_in * 1000);
  
  if (Date.now() > expiresAt - 300000) {
    console.log('Refreshing token...');
    const response = await fetch(
      `https://login.microsoftonline.com/${CONFIG.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CONFIG.clientId,
          refresh_token: tokens.refresh_token,
          grant_type: 'refresh_token',
          scope: 'https://graph.microsoft.com/.default'
        })
      }
    );
    
    const newTokens = await response.json();
    if (newTokens.error) {
      throw new Error(`Token refresh failed: ${newTokens.error_description}`);
    }
    
    newTokens.obtained_at = Date.now();
    fs.writeFileSync(CONFIG.tokenFile, JSON.stringify(newTokens, null, 2));
    return newTokens.access_token;
  }
  
  return tokens.access_token;
}

async function createSubscription() {
  const token = await getAccessToken();
  
  // Teams subscription - expires in 60 minutes (Graph API limit for chat subscriptions)
  const subscription = {
    changeType: 'created',
    notificationUrl: 'https://microsoft.acuity.expert/webhook/teams/max',
    resource: '/me/chats/getAllMessages',
    expirationDateTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    clientState: 'max-teams-test'
  };
  
  console.log('Creating Teams subscription...');
  console.log('Resource:', subscription.resource);
  console.log('Notification URL:', subscription.notificationUrl);
  console.log('Expires:', subscription.expirationDateTime);
  
  const response = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(subscription)
  });
  
  const result = await response.json();
  
  if (response.ok) {
    console.log('\n✓ Subscription created successfully!');
    console.log('ID:', result.id);
    console.log('Expires:', result.expirationDateTime);
    console.log('\nTest by sending a message to Max on Teams (1:1 chat with Luca)');
  } else {
    console.error('\n✗ Failed to create subscription');
    console.error('Error:', result.error?.message || JSON.stringify(result));
  }
}

createSubscription().catch(console.error);
