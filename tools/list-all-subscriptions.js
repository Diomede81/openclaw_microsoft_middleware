#!/usr/bin/env node
/**
 * List All Microsoft Graph Subscriptions - Templated Version
 * 
 * Usage:
 *   node list-all-subscriptions.js                 # List for all configured agents
 *   node list-all-subscriptions.js --agent max     # List for specific agent
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');

// Parse command line args
const args = process.argv.slice(2);
let specificAgent = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--agent' && args[i + 1]) {
    specificAgent = args[i + 1].toUpperCase();
  }
}

// Get enabled agents from environment
function getEnabledAgents() {
  const enabled = process.env.ENABLED_AGENTS;
  if (!enabled) {
    // Auto-detect from environment variables
    const agents = [];
    const envKeys = Object.keys(process.env);
    const agentPattern = /^([A-Z]+)_CLIENT_ID$/;
    
    for (const key of envKeys) {
      const match = key.match(agentPattern);
      if (match) {
        agents.push(match[1]);
      }
    }
    return agents;
  }
  return enabled.split(',').map(a => a.trim().toUpperCase());
}

// Load agent config
function loadAgentConfig(agentName) {
  const prefix = agentName.toUpperCase();
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const tenantId = process.env[`${prefix}_TENANT_ID`];
  const tokenFile = process.env[`${prefix}_TOKEN_FILE`];
  
  if (!clientId || !tenantId || !tokenFile) {
    return null;
  }
  
  return { name: agentName, clientId, tenantId, tokenFile };
}

// Refresh token if needed
async function refreshToken(config) {
  if (!fs.existsSync(config.tokenFile)) {
    console.log(`  ⚠️ Token file not found: ${config.tokenFile}`);
    return null;
  }
  
  const tokenData = JSON.parse(fs.readFileSync(config.tokenFile, 'utf8'));
  
  // Check if token needs refresh (within 5 minutes of expiry)
  const expiresAt = (tokenData.obtained_at || 0) + ((tokenData.expires_in || 3600) * 1000);
  const needsRefresh = Date.now() > (expiresAt - 300000);
  
  if (needsRefresh && tokenData.refresh_token) {
    const response = await fetch(
      `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId,
          grant_type: 'refresh_token',
          refresh_token: tokenData.refresh_token,
          scope: tokenData.scope || 'https://graph.microsoft.com/.default offline_access'
        })
      }
    );
    
    const newToken = await response.json();
    if (newToken.access_token) {
      newToken.obtained_at = Date.now();
      fs.writeFileSync(config.tokenFile, JSON.stringify(newToken, null, 2), { mode: 0o600 });
      return newToken.access_token;
    }
  }
  
  return tokenData.access_token;
}

// List subscriptions for an agent
async function listSubscriptions(config) {
  console.log(`\n📋 ${config.name}`);
  console.log('─'.repeat(40));
  
  const accessToken = await refreshToken(config);
  if (!accessToken) {
    console.log('  ❌ Could not get access token');
    return;
  }
  
  const response = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  
  const data = await response.json();
  
  if (data.error) {
    console.log(`  ❌ Error: ${data.error.message}`);
    return;
  }
  
  if (!data.value || data.value.length === 0) {
    console.log('  No active subscriptions');
    return;
  }
  
  for (const sub of data.value) {
    const expiresAt = new Date(sub.expirationDateTime);
    const now = new Date();
    const hoursLeft = Math.round((expiresAt - now) / 3600000);
    
    console.log(`\n  📌 ${sub.resource}`);
    console.log(`     ID: ${sub.id}`);
    console.log(`     Type: ${sub.changeType}`);
    console.log(`     Expires: ${expiresAt.toISOString()} (${hoursLeft}h remaining)`);
    console.log(`     Webhook: ${sub.notificationUrl}`);
  }
}

async function main() {
  console.log('\n🔍 Microsoft Graph Subscriptions');
  console.log('=================================');
  
  const agents = specificAgent ? [specificAgent] : getEnabledAgents();
  
  if (agents.length === 0) {
    console.log('\n❌ No agents configured. Set ENABLED_AGENTS or add agent config to .env\n');
    process.exit(1);
  }
  
  for (const agentName of agents) {
    const config = loadAgentConfig(agentName);
    if (!config) {
      console.log(`\n⚠️ Skipping ${agentName} - missing configuration`);
      continue;
    }
    
    await listSubscriptions(config);
  }
  
  console.log('\n');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
