#!/usr/bin/env node
/**
 * Create Test Subscription - Templated Version
 * Creates a Microsoft Graph subscription for testing webhooks
 * 
 * Usage:
 *   node create-test-subscription.js --agent max --resource mail
 *   node create-test-subscription.js --agent kim --resource calendar
 *   node create-test-subscription.js --agent sophia --resource teams
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
let resourceType = 'mail';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--agent' && args[i + 1]) {
    agentName = args[i + 1];
  }
  if (args[i] === '--resource' && args[i + 1]) {
    resourceType = args[i + 1];
  }
}

agentName = agentName.toUpperCase();

// Load agent config from environment
const CLIENT_ID = process.env[`${agentName}_CLIENT_ID`];
const TENANT_ID = process.env[`${agentName}_TENANT_ID`];
const TOKEN_FILE = process.env[`${agentName}_TOKEN_FILE`];
const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL || process.env.PUBLIC_URL;

// Validate required config
if (!CLIENT_ID || !TENANT_ID || !TOKEN_FILE) {
  console.error(`\n❌ Missing configuration for agent: ${agentName}`);
  console.error('\nRequired environment variables:');
  console.error(`  ${agentName}_CLIENT_ID`);
  console.error(`  ${agentName}_TENANT_ID`);
  console.error(`  ${agentName}_TOKEN_FILE`);
  process.exit(1);
}

if (!WEBHOOK_BASE_URL) {
  console.error('\n❌ Missing WEBHOOK_BASE_URL or PUBLIC_URL in environment');
  process.exit(1);
}

// Resource configurations
const RESOURCES = {
  mail: {
    resource: 'me/mailFolders/inbox/messages',
    changeType: 'created',
    endpoint: 'email'
  },
  calendar: {
    resource: 'me/events',
    changeType: 'created,updated,deleted',
    endpoint: 'calendar'
  },
  teams: {
    resource: 'me/chats/getAllMessages',
    changeType: 'created',
    endpoint: 'teams'
  }
};

async function main() {
  const resourceConfig = RESOURCES[resourceType];
  if (!resourceConfig) {
    console.error(`\n❌ Unknown resource type: ${resourceType}`);
    console.error('Valid types: mail, calendar, teams\n');
    process.exit(1);
  }
  
  console.log(`\n📬 Creating ${resourceType} subscription for ${agentName}`);
  console.log('='.repeat(50));
  
  // Load token
  if (!fs.existsSync(TOKEN_FILE)) {
    console.error(`\n❌ Token file not found: ${TOKEN_FILE}`);
    console.error('Run: node scripts/generate-token.js --agent', agentName.toLowerCase());
    process.exit(1);
  }
  
  let tokenData = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  
  // Refresh if needed
  const expiresAt = (tokenData.obtained_at || 0) + ((tokenData.expires_in || 3600) * 1000);
  if (Date.now() > expiresAt - 300000) {
    console.log('Refreshing token...');
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
      console.error('❌ Failed to refresh token:', tokenData.error_description || tokenData.error);
      process.exit(1);
    }
    tokenData.obtained_at = Date.now();
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2), { mode: 0o600 });
  }
  
  // Create subscription
  const notificationUrl = `${WEBHOOK_BASE_URL}/webhook/${resourceConfig.endpoint}/${agentName.toLowerCase()}`;
  const expirationDateTime = new Date(Date.now() + 4230 * 60 * 1000).toISOString(); // ~3 days
  
  console.log(`\nResource: ${resourceConfig.resource}`);
  console.log(`Change type: ${resourceConfig.changeType}`);
  console.log(`Webhook URL: ${notificationUrl}`);
  console.log(`Expires: ${expirationDateTime}\n`);
  
  const response = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      changeType: resourceConfig.changeType,
      notificationUrl: notificationUrl,
      resource: resourceConfig.resource,
      expirationDateTime: expirationDateTime,
      clientState: `openclaw-${agentName.toLowerCase()}-${resourceType}`
    })
  });
  
  const result = await response.json();
  
  if (result.error) {
    console.error('❌ Failed to create subscription:', result.error.message);
    if (result.error.innerError) {
      console.error('   Details:', JSON.stringify(result.error.innerError, null, 2));
    }
    process.exit(1);
  }
  
  console.log('✅ Subscription created successfully!');
  console.log(`   ID: ${result.id}`);
  console.log(`   Expires: ${result.expirationDateTime}\n`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
