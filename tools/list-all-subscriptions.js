#!/usr/bin/env node
const fs = require('fs');

const agents = [
  {
    name: 'max',
    clientId: '79b3f60a-ddfe-4029-8af4-1c95a37c6aa7',
    tenantId: '982780f8-0424-4e57-9cc0-bee3d6acc797',
    tokenFile: '/home/lucalicata/clawd/max-microsoft-tokens.json'
  },
  {
    name: 'sophia',
    clientId: '50d301c0-ad4f-458b-95ec-f3c966f60f6c',
    tenantId: 'f2b38637-cb43-45b5-a5e8-e7a09fe436bb',
    tokenFile: '/home/lucalicata/clawd/sophia-microsoft-tokens.json'
  }
];

async function getAccessToken(agent) {
  const tokens = JSON.parse(fs.readFileSync(agent.tokenFile, 'utf8'));
  const expiresAt = tokens.obtained_at + (tokens.expires_in * 1000);
  
  if (Date.now() > expiresAt - 300000) {
    const response = await fetch(
      `https://login.microsoftonline.com/${agent.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: agent.clientId,
          refresh_token: tokens.refresh_token,
          grant_type: 'refresh_token',
          scope: 'https://graph.microsoft.com/.default'
        })
      }
    );
    
    const newTokens = await response.json();
    newTokens.obtained_at = Date.now();
    fs.writeFileSync(agent.tokenFile, JSON.stringify(newTokens, null, 2));
    return newTokens.access_token;
  }
  
  return tokens.access_token;
}

async function listSubscriptions(agent) {
  const token = await getAccessToken(agent);
  const response = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  const data = await response.json();
  return data.value || [];
}

async function deleteSubscription(agent, subId) {
  const token = await getAccessToken(agent);
  await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${subId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
}

async function main() {
  const action = process.argv[2] || 'list';
  
  for (const agent of agents) {
    console.log(`\n=== ${agent.name.toUpperCase()} ===`);
    
    try {
      const subs = await listSubscriptions(agent);
      
      if (subs.length === 0) {
        console.log('No active subscriptions');
        continue;
      }
      
      console.log(`Found ${subs.length} active subscriptions:\n`);
      
      for (const sub of subs) {
        console.log(`ID: ${sub.id}`);
        console.log(`Resource: ${sub.resource}`);
        console.log(`Notification URL: ${sub.notificationUrl}`);
        console.log(`Client State: ${sub.clientState}`);
        console.log(`Expires: ${sub.expirationDateTime}`);
        console.log('---');
        
        if (action === 'delete') {
          console.log(`Deleting ${sub.id}...`);
          await deleteSubscription(agent, sub.id);
          console.log('✓ Deleted\n');
        }
      }
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }
  }
  
  if (action === 'list') {
    console.log('\nTo delete all subscriptions, run: node list-all-subscriptions.js delete');
  }
}

main().catch(console.error);
