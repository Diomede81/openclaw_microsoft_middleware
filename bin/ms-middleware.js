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
  status                   Check if server is running
  install-service [name]   Create systemd user service file
  docs [topic]             Show documentation (install, teams, tokens, setup)

Examples:
  ms-middleware init
  ms-middleware start
  ms-middleware token max
  ms-middleware subscriptions kim
  ms-middleware install-service my-middleware
  ms-middleware docs install

Environment:
  Config is loaded from .env in current directory or package directory.
  Copy .env.example to .env and configure your agents.

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
