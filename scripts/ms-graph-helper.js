#!/usr/bin/env node
/**
 * MS Graph Helper Server
 * Handles token refresh and proxies requests to MS Graph API
 * n8n calls this instead of MS Graph directly
 */

const http = require('http');
const fs = require('fs');
const { readSecret, writeSecret } = require('/home/lucalicata/clawd/scripts/age-secrets');

const PORT = 3010;

// Agent configurations
const agents = {
  max: {
    clientId: '79b3f60a-ddfe-4029-8af4-1c95a37c6aa7',
    tenantId: '982780f8-0424-4e57-9cc0-bee3d6acc797',
    tokenFile: 'max-microsoft-tokens.json.age',
    encrypted: true
  },
  sophia: {
    clientId: '79b3f60a-ddfe-4029-8af4-1c95a37c6aa7',
    tenantId: '982780f8-0424-4e57-9cc0-bee3d6acc797',
    tokenFile: 'sophia-microsoft-tokens.json.age',
    encrypted: true
  },
  kim: {
    clientId: '076066b8-03bd-4093-9acb-60d46d732d5f',
    tenantId: '53965fed-1581-4e00-92a7-7bb79806eecd',
    tokenFile: '/home/lucalicata/clawd/kim-microsoft-tokens.json',
    encrypted: false
  }
};

async function getAccessToken(agent) {
  const config = agents[agent];
  if (!config) throw new Error(`Unknown agent: ${agent}`);
  
  let tokens;
  if (config.encrypted) {
    tokens = readSecret(config.tokenFile);
  } else {
    tokens = JSON.parse(fs.readFileSync(config.tokenFile));
  }
  
  const expiresAt = tokens.obtained_at + (tokens.expires_in * 1000);
  
  // Refresh if expiring within 5 minutes
  if (Date.now() > expiresAt - 300000) {
    console.log(`Refreshing ${agent} tokens...`);
    const response = await fetch(
      `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId,
          refresh_token: tokens.refresh_token,
          grant_type: 'refresh_token'
        })
      }
    );
    const newTokens = await response.json();
    if (newTokens.error) throw new Error(newTokens.error_description);
    newTokens.obtained_at = Date.now();
    
    if (config.encrypted) {
      writeSecret(config.tokenFile, newTokens);
    } else {
      fs.writeFileSync(config.tokenFile, JSON.stringify(newTokens, null, 2));
    }
    return newTokens.access_token;
  }
  
  return tokens.access_token;
}

async function proxyRequest(agent, path) {
  const token = await getAccessToken(agent);
  const url = `https://graph.microsoft.com/v1.0${path}`;
  
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  return response.json();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  
  // Health check
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  
  // Proxy request: /graph/:agent/...path
  if (url.pathname.startsWith('/graph/')) {
    const parts = url.pathname.slice(7).split('/');
    const agent = parts[0];
    const graphPath = '/' + parts.slice(1).join('/') + url.search;
    
    try {
      const data = await proxyRequest(agent, graphPath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      console.error(`Error proxying ${agent} request:`, err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`MS Graph Helper running on http://localhost:${PORT}`);
  console.log('Endpoints:');
  console.log('  GET /health - Health check');
  console.log('  GET /graph/:agent/... - Proxy to MS Graph API');
  console.log('    e.g., /graph/max/me/chats/{chatId}/messages/{messageId}');
});
