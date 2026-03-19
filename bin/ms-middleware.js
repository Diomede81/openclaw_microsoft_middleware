#!/usr/bin/env node
/**
 * OpenClaw Microsoft Middleware CLI
 * 
 * Commands:
 *   ms-middleware start              Start the middleware server
 *   ms-middleware init               Initialize config in current directory
 *   ms-middleware token <agent>      Generate OAuth token for an agent
 *   ms-middleware token-device <agent>  Generate token via device code flow
 *   ms-middleware subscriptions      List all active subscriptions
 *   ms-middleware status             Check server status
 *   ms-middleware install-service    Install as systemd user service
 */

const path = require('path');
const fs = require('fs');

// Find .env file - check cwd first, then package directory
const cwdEnv = path.join(process.cwd(), '.env');
const pkgEnv = path.join(__dirname, '..', '.env');

if (fs.existsSync(cwdEnv)) {
  require('dotenv').config({ path: cwdEnv });
} else if (fs.existsSync(pkgEnv)) {
  require('dotenv').config({ path: pkgEnv });
}

const command = process.argv[2];
const args = process.argv.slice(3);

const commands = {
  start: async () => require('../lib/server'),
  
  init: async () => {
    const targetDir = process.cwd();
    const exampleEnv = path.join(__dirname, '..', '.env.example');
    const targetEnv = path.join(targetDir, '.env');
    
    if (fs.existsSync(targetEnv)) {
      console.log('⚠️  .env already exists in current directory');
      console.log('   Edit it manually or delete and run init again\n');
      return;
    }
    
    fs.copyFileSync(exampleEnv, targetEnv);
    console.log('✅ Created .env file');
    console.log('   Edit it with your agent configuration\n');
    console.log('   Then run: ms-middleware start\n');
  },
  
  token: async () => {
    const agent = args[0];
    if (!agent) {
      console.error('Usage: ms-middleware token <agent>');
      console.error('Example: ms-middleware token max\n');
      process.exit(1);
    }
    process.env.AGENT_NAME = agent.toUpperCase();
    require('../scripts/generate-token');
  },
  
  'token-device': async () => {
    const agent = args[0];
    if (!agent) {
      console.error('Usage: ms-middleware token-device <agent>');
      console.error('Example: ms-middleware token-device kim\n');
      process.exit(1);
    }
    process.env.AGENT_NAME = agent.toUpperCase();
    require('../scripts/generate-token-device');
  },
  
  subscriptions: async () => {
    const agent = args[0];
    if (agent) {
      process.argv = [process.argv[0], process.argv[1], '--agent', agent];
    }
    require('../tools/list-all-subscriptions');
  },
  
  status: async () => {
    const port = process.env.PORT || 3007;
    try {
      const response = await fetch(`http://localhost:${port}/health`);
      const data = await response.json();
      console.log('\n🟢 Server is running');
      console.log(`   Port: ${port}`);
      console.log(`   Agents: ${data.agents?.join(', ') || 'none configured'}`);
      console.log(`   Uptime: ${data.uptime || 'unknown'}\n`);
    } catch (err) {
      console.log('\n🔴 Server is not running');
      console.log(`   Expected on port ${port}`);
      console.log('   Run: ms-middleware start\n');
    }
  },
  
  sessions: async () => {
    const subcommand = args[0];
    const port = process.env.PORT || 3007;
    const baseUrl = `http://localhost:${port}`;
    
    if (!subcommand || subcommand === 'stats') {
      // Show session statistics
      try {
        const resp = await fetch(`${baseUrl}/sessions`);
        const stats = await resp.json();
        console.log('\n📊 Session Store Statistics\n');
        console.log(`   Database: ${stats.dbPath}`);
        console.log(`   Total sessions: ${stats.totalSessions}`);
        console.log(`   Total messages: ${stats.totalMessages}`);
        console.log(`   Max messages per session: ${stats.maxMessages}`);
        console.log(`   Messages injected per prompt: ${stats.injectMessages}\n`);
      } catch (err) {
        console.error('Error: Server not running or not reachable');
      }
      return;
    }
    
    if (subcommand === 'list') {
      // List sessions for an agent
      const agent = args[1];
      if (!agent) {
        console.error('Usage: ms-middleware sessions list <agent>');
        process.exit(1);
      }
      try {
        const resp = await fetch(`${baseUrl}/sessions/${agent}`);
        const data = await resp.json();
        console.log(`\n📋 Sessions for ${agent}\n`);
        if (data.sessions.length === 0) {
          console.log('   No sessions found.\n');
        } else {
          for (const s of data.sessions) {
            console.log(`   ${s.channel}:${s.chat_id.substring(0, 30)}...`);
            console.log(`      Messages: ${s.message_count}, Updated: ${s.updated_at}\n`);
          }
        }
      } catch (err) {
        console.error('Error:', err.message);
      }
      return;
    }
    
    if (subcommand === 'clear') {
      // Clear a specific session
      const agent = args[1];
      const chatId = args[2];
      if (!agent || !chatId) {
        console.error('Usage: ms-middleware sessions clear <agent> <chatId>');
        process.exit(1);
      }
      try {
        const resp = await fetch(`${baseUrl}/sessions/${agent}/teams/${encodeURIComponent(chatId)}`, {
          method: 'DELETE'
        });
        const data = await resp.json();
        console.log(`\n✅ Cleared session: ${data.cleared}\n`);
      } catch (err) {
        console.error('Error:', err.message);
      }
      return;
    }
    
    console.log(`
Usage: ms-middleware sessions <command>

Commands:
  stats              Show session store statistics
  list <agent>       List all sessions for an agent
  clear <agent> <chatId>  Clear messages from a session
`);
  },
  
  tunnel: async () => {
    const CloudflareTunnel = require('../lib/cloudflare/tunnel');
    const subcommand = args[0];
    
    const tunnel = new CloudflareTunnel();
    
    if (!subcommand || subcommand === 'status') {
      try {
        await tunnel.status();
      } catch (err) {
        console.error('Error:', err.message);
        if (err.message.includes('Missing required config')) {
          console.log('\nAdd to your .env:');
          console.log('  CLOUDFLARE_API_TOKEN=your_token');
          console.log('  CLOUDFLARE_ACCOUNT_ID=your_account_id');
          console.log('  CLOUDFLARE_DOMAIN=yourdomain.com');
          console.log('  CLOUDFLARE_SUBDOMAIN=microsoft  # optional, default: microsoft');
        }
      }
      return;
    }
    
    if (subcommand === 'setup') {
      try {
        await tunnel.setup();
      } catch (err) {
        console.error('Error:', err.message);
      }
      return;
    }
    
    if (subcommand === 'run') {
      try {
        tunnel.runTunnel();
      } catch (err) {
        console.error('Error:', err.message);
      }
      return;
    }
    
    if (subcommand === 'create') {
      try {
        tunnel.validate();
        await tunnel.createTunnel(tunnel.tunnelName);
      } catch (err) {
        console.error('Error:', err.message);
      }
      return;
    }
    
    if (subcommand === 'delete') {
      try {
        tunnel.validate();
        const t = await tunnel.getTunnelByName(tunnel.tunnelName);
        if (t) {
          await tunnel.deleteTunnel(t.id);
        } else {
          console.log('Tunnel not found');
        }
      } catch (err) {
        console.error('Error:', err.message);
      }
      return;
    }
    
    if (subcommand === 'dns') {
      try {
        tunnel.validate();
        const t = await tunnel.getTunnelByName(tunnel.tunnelName);
        if (t) {
          await tunnel.configureDNS(t.id);
        } else {
          console.log('Tunnel not found. Run: ms-middleware tunnel create');
        }
      } catch (err) {
        console.error('Error:', err.message);
      }
      return;
    }
    
    if (subcommand === 'config') {
      try {
        tunnel.validate();
        const t = await tunnel.getTunnelByName(tunnel.tunnelName);
        if (t) {
          tunnel.generateConfig(t.id);
        } else {
          console.log('Tunnel not found. Run: ms-middleware tunnel create');
        }
      } catch (err) {
        console.error('Error:', err.message);
      }
      return;
    }
    
    if (subcommand === 'service') {
      try {
        tunnel.generateService();
      } catch (err) {
        console.error('Error:', err.message);
      }
      return;
    }
    
    console.log(`
Usage: ms-middleware tunnel <command>

Commands:
  status             Show tunnel status
  setup              Full setup: create tunnel, DNS, config, service
  run                Run cloudflared tunnel (foreground)
  create             Create a new tunnel
  delete             Delete the tunnel
  dns                Configure DNS record
  config             Generate cloudflared config file
  service            Generate systemd service file

Configuration (.env):
  CLOUDFLARE_API_TOKEN     API token with Tunnel permissions
  CLOUDFLARE_ACCOUNT_ID    Your Cloudflare account ID
  CLOUDFLARE_DOMAIN        Your domain (e.g., example.com)
  CLOUDFLARE_SUBDOMAIN     Subdomain for webhook (default: microsoft)
  CLOUDFLARE_TUNNEL_NAME   Tunnel name (default: ms-middleware)
`);
  },
  
  'install-service': async () => {
    const serviceName = args[0] || 'ms-middleware';
    const workDir = process.cwd();
    const nodePath = process.execPath;
    const binPath = path.join(__dirname, 'ms-middleware.js');
    
    const serviceContent = `[Unit]
Description=OpenClaw Microsoft Middleware
After=network.target

[Service]
Type=simple
WorkingDirectory=${workDir}
ExecStart=${nodePath} ${binPath} start
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;
    
    const serviceDir = path.join(process.env.HOME, '.config', 'systemd', 'user');
    const servicePath = path.join(serviceDir, `${serviceName}.service`);
    
    if (!fs.existsSync(serviceDir)) {
      fs.mkdirSync(serviceDir, { recursive: true });
    }
    
    fs.writeFileSync(servicePath, serviceContent);
    
    console.log(`\n✅ Service file created: ${servicePath}`);
    console.log('\nTo enable and start:');
    console.log(`   systemctl --user daemon-reload`);
    console.log(`   systemctl --user enable ${serviceName}`);
    console.log(`   systemctl --user start ${serviceName}`);
    console.log(`\nTo check status:`);
    console.log(`   systemctl --user status ${serviceName}\n`);
  },
  
  docs: async () => {
    const docType = args[0];
    const pkgDir = path.join(__dirname, '..');
    
    const docs = {
      install: 'AGENT_INSTALL_GUIDE.md',
      teams: 'AGENT_TEAMS_SETUP.md',
      tokens: 'TOKEN_MANAGEMENT.md',
      setup: 'SETUP.md',
      attachments: 'ATTACHMENTS.md',
      resources: 'SUPPORTED_RESOURCES.md'
    };
    
    if (!docType) {
      // List all docs
      console.log('\n📚 Microsoft Middleware Documentation\n');
      console.log('Available guides:');
      console.log('  ms-middleware docs install      Installation guide');
      console.log('  ms-middleware docs teams        Teams setup for agents');
      console.log('  ms-middleware docs tokens       Token management');
      console.log('  ms-middleware docs setup        Azure AD app setup');
      console.log('  ms-middleware docs attachments  Email attachments');
      console.log('  ms-middleware docs resources    Supported Graph resources');
      console.log('\nOnline: https://github.com/Diomede81/openclaw_microsoft_middleware\n');
      return;
    }
    
    const docFile = docs[docType];
    if (!docFile) {
      console.error(`Unknown doc: ${docType}`);
      console.error('Available: ' + Object.keys(docs).join(', '));
      process.exit(1);
    }
    
    const docPath = path.join(pkgDir, docFile);
    if (!fs.existsSync(docPath)) {
      console.error(`Doc file not found: ${docPath}`);
      process.exit(1);
    }
    
    // Print the doc content
    console.log('\n' + '='.repeat(60));
    console.log(fs.readFileSync(docPath, 'utf8'));
    console.log('='.repeat(60) + '\n');
  },
  
  help: async () => {
    console.log(`
OpenClaw Microsoft Middleware CLI

Usage: ms-middleware <command> [options]

Commands:
  start                    Start the middleware server
  init                     Initialize .env config in current directory
  token <agent>            Generate OAuth token (browser flow)
  token-device <agent>     Generate OAuth token (device code flow)
  subscriptions [agent]    List active Microsoft Graph subscriptions
  sessions [subcommand]    Manage conversation history sessions
  tunnel [subcommand]      Manage Cloudflare tunnel for webhooks
  status                   Check if server is running
  install-service [name]   Create systemd user service file
  docs [topic]             Show documentation (install, teams, tokens, setup)

Session Commands:
  sessions stats           Show session store statistics
  sessions list <agent>    List all sessions for an agent
  sessions clear <agent> <chatId>  Clear messages from a session

Tunnel Commands:
  tunnel status            Show tunnel status
  tunnel setup             Full setup: create tunnel, DNS, config, service
  tunnel run               Run cloudflared tunnel (foreground)
  tunnel create            Create a new tunnel
  tunnel delete            Delete the tunnel

Examples:
  ms-middleware init
  ms-middleware start
  ms-middleware token max
  ms-middleware tunnel setup
  ms-middleware sessions list sophia
  ms-middleware install-service my-middleware
  ms-middleware docs install

Environment:
  Config is loaded from .env in current directory or package directory.
  Copy .env.example to .env and configure your agents.
  
Session store config (optional in .env):
  SESSION_MAX_MESSAGES=30       Max messages before truncation
  SESSION_INJECT_MESSAGES=10    Messages to inject into prompt
  SESSION_DB_PATH=./data/sessions.db   Database location

Cloudflare tunnel config (optional in .env):
  CLOUDFLARE_API_TOKEN          API token with Tunnel permissions
  CLOUDFLARE_ACCOUNT_ID         Your Cloudflare account ID
  CLOUDFLARE_DOMAIN             Your domain (e.g., example.com)
  CLOUDFLARE_SUBDOMAIN          Subdomain for webhook (default: microsoft)

Documentation:
  https://github.com/Diomede81/openclaw_microsoft_middleware
`);
  }
};

// Run command
const cmd = commands[command] || commands.help;
cmd().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
