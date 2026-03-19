#!/usr/bin/env node
/**
 * Microsoft Graph API Helper Server - Templated Version
 * Provides token refresh and Graph API proxy endpoints
 * 
 * Usage:
 *   node ms-graph-helper.js                # Uses default port 3008
 *   PORT=3009 node ms-graph-helper.js      # Custom port
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.GRAPH_HELPER_PORT || process.env.PORT || '3008', 10);

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
        agents.push(match[1].toLowerCase());
      }
    }
    return agents;
  }
  return enabled.split(',').map(a => a.trim().toLowerCase());
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

// Refresh token
async function refreshToken(config) {
  if (!fs.existsSync(config.tokenFile)) {
    throw new Error(`Token file not found: ${config.tokenFile}`);
  }
  
  const tokenData = JSON.parse(fs.readFileSync(config.tokenFile, 'utf8'));
  
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
  
  if (newToken.error) {
    throw new Error(newToken.error_description || newToken.error);
  }
  
  newToken.obtained_at = Date.now();
  fs.writeFileSync(config.tokenFile, JSON.stringify(newToken, null, 2), { mode: 0o600 });
  
  return newToken;
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // Health check
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', agents: getEnabledAgents() }));
    return;
  }
  
  // Refresh token endpoint: POST /refresh/:agent
  if (url.pathname.startsWith('/refresh/') && req.method === 'POST') {
    const agentName = url.pathname.split('/')[2];
    const config = loadAgentConfig(agentName);
    
    if (!config) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Agent not found: ${agentName}` }));
      return;
    }
    
    try {
      const newToken = await refreshToken(config);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        agent: agentName,
        expires_in: newToken.expires_in
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  
  // Get token endpoint: GET /token/:agent
  if (url.pathname.startsWith('/token/') && req.method === 'GET') {
    const agentName = url.pathname.split('/')[2];
    const config = loadAgentConfig(agentName);
    
    if (!config) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Agent not found: ${agentName}` }));
      return;
    }
    
    try {
      if (!fs.existsSync(config.tokenFile)) {
        throw new Error('Token file not found');
      }
      
      const tokenData = JSON.parse(fs.readFileSync(config.tokenFile, 'utf8'));
      const expiresAt = (tokenData.obtained_at || 0) + ((tokenData.expires_in || 3600) * 1000);
      const needsRefresh = Date.now() > (expiresAt - 300000);
      
      if (needsRefresh && tokenData.refresh_token) {
        const newToken = await refreshToken(config);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          access_token: newToken.access_token,
          expires_in: newToken.expires_in,
          refreshed: true
        }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          access_token: tokenData.access_token,
          expires_in: Math.round((expiresAt - Date.now()) / 1000),
          refreshed: false
        }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  
  // List agents
  if (url.pathname === '/agents') {
    const agents = getEnabledAgents();
    const agentInfo = agents.map(name => {
      const config = loadAgentConfig(name);
      return {
        name,
        configured: !!config,
        tokenFile: config?.tokenFile,
        hasToken: config ? fs.existsSync(config.tokenFile) : false
      };
    });
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(agentInfo, null, 2));
    return;
  }
  
  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`\n🔧 MS Graph Helper running on http://localhost:${PORT}`);
  console.log(`   Configured agents: ${getEnabledAgents().join(', ') || 'none'}`);
  console.log('\n   Endpoints:');
  console.log(`   GET  /health           - Health check`);
  console.log(`   GET  /agents           - List configured agents`);
  console.log(`   GET  /token/:agent     - Get access token (auto-refresh)`);
  console.log(`   POST /refresh/:agent   - Force token refresh\n`);
});
