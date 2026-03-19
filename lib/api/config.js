/**
 * Configuration API
 * REST endpoints for managing middleware configuration
 * Used by web UI and external tools
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const router = express.Router();

// Config file path
const getEnvPath = () => process.env.ENV_FILE_PATH || path.join(process.cwd(), '.env');

/**
 * Parse .env file into object
 */
function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  const config = {};
  
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      config[key] = value;
    }
  }
  
  return config;
}

/**
 * Write config back to .env file
 */
function writeEnvFile(filePath, config, comments = {}) {
  const lines = [];
  
  // Group by section
  const sections = {
    server: ['PORT', 'PUBLIC_URL', 'NODE_ENV'],
    agents: [],
    sessions: ['SESSION_MAX_MESSAGES', 'SESSION_INJECT_MESSAGES', 'SESSION_DB_PATH'],
    cloudflare: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_DOMAIN', 
                 'CLOUDFLARE_SUBDOMAIN', 'CLOUDFLARE_TUNNEL_NAME', 'CLOUDFLARE_ZONE_ID']
  };
  
  // Find agent keys
  const agentNames = new Set();
  for (const key of Object.keys(config)) {
    const match = key.match(/^([A-Z]+)_(CLIENT_ID|TENANT_ID|TOKEN_FILE|GATEWAY_URL|GATEWAY_TOKEN|DISPLAY_NAME|AGENT_ID)$/);
    if (match) {
      agentNames.add(match[1]);
    }
  }
  
  // Server section
  lines.push('# ============================================');
  lines.push('# SERVER CONFIGURATION');
  lines.push('# ============================================');
  for (const key of sections.server) {
    if (config[key] !== undefined) {
      lines.push(`${key}=${config[key]}`);
    }
  }
  lines.push('');
  
  // Enabled agents
  if (config.ENABLED_AGENTS) {
    lines.push(`ENABLED_AGENTS=${config.ENABLED_AGENTS}`);
    lines.push('');
  }
  
  // Agent sections
  for (const agent of agentNames) {
    lines.push(`# Agent: ${agent.toLowerCase()}`);
    const agentKeys = [
      `${agent}_CLIENT_ID`,
      `${agent}_CLIENT_SECRET`,
      `${agent}_TENANT_ID`,
      `${agent}_TOKEN_FILE`,
      `${agent}_GATEWAY_URL`,
      `${agent}_GATEWAY_TOKEN`,
      `${agent}_DISPLAY_NAME`,
      `${agent}_AGENT_ID`
    ];
    for (const key of agentKeys) {
      if (config[key] !== undefined) {
        lines.push(`${key}=${config[key]}`);
      }
    }
    lines.push('');
  }
  
  // Sessions section
  lines.push('# ============================================');
  lines.push('# SESSION STORE CONFIGURATION');
  lines.push('# ============================================');
  for (const key of sections.sessions) {
    if (config[key] !== undefined) {
      lines.push(`${key}=${config[key]}`);
    }
  }
  lines.push('');
  
  // Cloudflare section
  lines.push('# ============================================');
  lines.push('# CLOUDFLARE TUNNEL CONFIGURATION');
  lines.push('# ============================================');
  for (const key of sections.cloudflare) {
    if (config[key] !== undefined) {
      lines.push(`${key}=${config[key]}`);
    }
  }
  
  fs.writeFileSync(filePath, lines.join('\n') + '\n');
}

/**
 * Mask sensitive values
 */
function maskSensitive(config) {
  const sensitiveKeys = ['TOKEN', 'SECRET', 'PASSWORD', 'KEY', 'CREDENTIAL'];
  const masked = { ...config };
  
  for (const key of Object.keys(masked)) {
    if (sensitiveKeys.some(s => key.toUpperCase().includes(s))) {
      if (masked[key] && masked[key].length > 8) {
        masked[key] = masked[key].substring(0, 4) + '****' + masked[key].substring(masked[key].length - 4);
      } else if (masked[key]) {
        masked[key] = '****';
      }
    }
  }
  
  return masked;
}

/**
 * Extract agent config from flat env
 */
function extractAgents(config) {
  const agents = {};
  const enabledAgents = (config.ENABLED_AGENTS || '').split(',').map(a => a.trim()).filter(Boolean);
  
  for (const agent of enabledAgents) {
    const prefix = agent.toUpperCase();
    agents[agent] = {
      name: agent,
      enabled: true,
      clientId: config[`${prefix}_CLIENT_ID`],
      tenantId: config[`${prefix}_TENANT_ID`],
      tokenFile: config[`${prefix}_TOKEN_FILE`],
      gatewayUrl: config[`${prefix}_GATEWAY_URL`],
      gatewayToken: config[`${prefix}_GATEWAY_TOKEN`] ? '****' : undefined,
      displayName: config[`${prefix}_DISPLAY_NAME`],
      agentId: config[`${prefix}_AGENT_ID`]
    };
  }
  
  return agents;
}

// ============================================
// API ENDPOINTS
// ============================================

/**
 * GET /api/config
 * Get current configuration (sensitive values masked)
 */
router.get('/config', (req, res) => {
  try {
    const config = parseEnvFile(getEnvPath());
    res.json({
      ok: true,
      config: maskSensitive(config),
      envPath: getEnvPath()
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/config/agents
 * Get list of configured agents
 */
router.get('/config/agents', (req, res) => {
  try {
    const config = parseEnvFile(getEnvPath());
    const agents = extractAgents(config);
    res.json({
      ok: true,
      agents,
      enabledAgents: (config.ENABLED_AGENTS || '').split(',').map(a => a.trim()).filter(Boolean)
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/config/agents
 * Add or update an agent
 * Body: { name, clientId, tenantId, tokenFile, gatewayUrl, gatewayToken, displayName, agentId }
 */
router.post('/config/agents', (req, res) => {
  try {
    const { name, clientId, tenantId, tokenFile, gatewayUrl, gatewayToken, displayName, agentId } = req.body;
    
    if (!name || !clientId || !tenantId) {
      return res.status(400).json({ ok: false, error: 'Missing required fields: name, clientId, tenantId' });
    }
    
    const config = parseEnvFile(getEnvPath());
    const prefix = name.toUpperCase();
    
    // Update agent config
    config[`${prefix}_CLIENT_ID`] = clientId;
    config[`${prefix}_TENANT_ID`] = tenantId;
    if (tokenFile) config[`${prefix}_TOKEN_FILE`] = tokenFile;
    if (gatewayUrl) config[`${prefix}_GATEWAY_URL`] = gatewayUrl;
    if (gatewayToken) config[`${prefix}_GATEWAY_TOKEN`] = gatewayToken;
    if (displayName) config[`${prefix}_DISPLAY_NAME`] = displayName;
    if (agentId) config[`${prefix}_AGENT_ID`] = agentId || name;
    
    // Update enabled agents list
    const enabledAgents = (config.ENABLED_AGENTS || '').split(',').map(a => a.trim()).filter(Boolean);
    if (!enabledAgents.includes(name.toLowerCase())) {
      enabledAgents.push(name.toLowerCase());
      config.ENABLED_AGENTS = enabledAgents.join(',');
    }
    
    writeEnvFile(getEnvPath(), config);
    
    res.json({
      ok: true,
      message: `Agent ${name} configured. Restart middleware to apply changes.`,
      restartRequired: true
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * DELETE /api/config/agents/:name
 * Remove an agent
 */
router.delete('/config/agents/:name', (req, res) => {
  try {
    const { name } = req.params;
    const config = parseEnvFile(getEnvPath());
    const prefix = name.toUpperCase();
    
    // Remove agent keys
    const keysToRemove = Object.keys(config).filter(k => k.startsWith(`${prefix}_`));
    for (const key of keysToRemove) {
      delete config[key];
    }
    
    // Update enabled agents list
    const enabledAgents = (config.ENABLED_AGENTS || '').split(',')
      .map(a => a.trim())
      .filter(a => a && a.toLowerCase() !== name.toLowerCase());
    config.ENABLED_AGENTS = enabledAgents.join(',');
    
    writeEnvFile(getEnvPath(), config);
    
    res.json({
      ok: true,
      message: `Agent ${name} removed. Restart middleware to apply changes.`,
      restartRequired: true
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/config/server
 * Get server configuration
 */
router.get('/config/server', (req, res) => {
  try {
    const config = parseEnvFile(getEnvPath());
    res.json({
      ok: true,
      server: {
        port: config.PORT || 3007,
        publicUrl: config.PUBLIC_URL,
        nodeEnv: config.NODE_ENV || 'production'
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * PUT /api/config/server
 * Update server configuration
 * Body: { port, publicUrl }
 */
router.put('/config/server', (req, res) => {
  try {
    const { port, publicUrl } = req.body;
    const config = parseEnvFile(getEnvPath());
    
    if (port) config.PORT = String(port);
    if (publicUrl) config.PUBLIC_URL = publicUrl;
    
    writeEnvFile(getEnvPath(), config);
    
    res.json({
      ok: true,
      message: 'Server config updated. Restart middleware to apply changes.',
      restartRequired: true
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/config/cloudflare
 * Get Cloudflare configuration
 */
router.get('/config/cloudflare', (req, res) => {
  try {
    const config = parseEnvFile(getEnvPath());
    res.json({
      ok: true,
      cloudflare: {
        configured: !!config.CLOUDFLARE_API_TOKEN,
        accountId: config.CLOUDFLARE_ACCOUNT_ID,
        domain: config.CLOUDFLARE_DOMAIN,
        subdomain: config.CLOUDFLARE_SUBDOMAIN || 'microsoft',
        tunnelName: config.CLOUDFLARE_TUNNEL_NAME || 'ms-middleware',
        publicUrl: config.CLOUDFLARE_DOMAIN ? 
          `https://${config.CLOUDFLARE_SUBDOMAIN || 'microsoft'}.${config.CLOUDFLARE_DOMAIN}` : null
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * PUT /api/config/cloudflare
 * Update Cloudflare configuration
 * Body: { apiToken, accountId, domain, subdomain, tunnelName }
 */
router.put('/config/cloudflare', (req, res) => {
  try {
    const { apiToken, accountId, domain, subdomain, tunnelName, zoneId } = req.body;
    const config = parseEnvFile(getEnvPath());
    
    if (apiToken) config.CLOUDFLARE_API_TOKEN = apiToken;
    if (accountId) config.CLOUDFLARE_ACCOUNT_ID = accountId;
    if (domain) config.CLOUDFLARE_DOMAIN = domain;
    if (subdomain) config.CLOUDFLARE_SUBDOMAIN = subdomain;
    if (tunnelName) config.CLOUDFLARE_TUNNEL_NAME = tunnelName;
    if (zoneId) config.CLOUDFLARE_ZONE_ID = zoneId;
    
    writeEnvFile(getEnvPath(), config);
    
    res.json({
      ok: true,
      message: 'Cloudflare config updated.',
      publicUrl: `https://${subdomain || config.CLOUDFLARE_SUBDOMAIN || 'microsoft'}.${domain || config.CLOUDFLARE_DOMAIN}`
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/config/sessions
 * Get session store configuration
 */
router.get('/config/sessions', (req, res) => {
  try {
    const config = parseEnvFile(getEnvPath());
    res.json({
      ok: true,
      sessions: {
        maxMessages: parseInt(config.SESSION_MAX_MESSAGES) || 30,
        injectMessages: parseInt(config.SESSION_INJECT_MESSAGES) || 10,
        dbPath: config.SESSION_DB_PATH || './data/sessions.db'
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * PUT /api/config/sessions
 * Update session store configuration
 * Body: { maxMessages, injectMessages, dbPath }
 */
router.put('/config/sessions', (req, res) => {
  try {
    const { maxMessages, injectMessages, dbPath } = req.body;
    const config = parseEnvFile(getEnvPath());
    
    if (maxMessages) config.SESSION_MAX_MESSAGES = String(maxMessages);
    if (injectMessages) config.SESSION_INJECT_MESSAGES = String(injectMessages);
    if (dbPath) config.SESSION_DB_PATH = dbPath;
    
    writeEnvFile(getEnvPath(), config);
    
    res.json({
      ok: true,
      message: 'Session config updated. Restart middleware to apply changes.',
      restartRequired: true
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/config/validate
 * Validate current configuration
 */
router.post('/config/validate', async (req, res) => {
  try {
    const config = parseEnvFile(getEnvPath());
    const issues = [];
    const warnings = [];
    
    // Check required fields
    if (!config.PUBLIC_URL) {
      issues.push('PUBLIC_URL is not set - webhooks will not work');
    }
    
    // Check agents
    const enabledAgents = (config.ENABLED_AGENTS || '').split(',').map(a => a.trim()).filter(Boolean);
    if (enabledAgents.length === 0) {
      warnings.push('No agents configured');
    }
    
    for (const agent of enabledAgents) {
      const prefix = agent.toUpperCase();
      if (!config[`${prefix}_CLIENT_ID`]) issues.push(`${agent}: Missing CLIENT_ID`);
      if (!config[`${prefix}_TENANT_ID`]) issues.push(`${agent}: Missing TENANT_ID`);
      if (!config[`${prefix}_TOKEN_FILE`]) issues.push(`${agent}: Missing TOKEN_FILE`);
      if (!config[`${prefix}_GATEWAY_URL`]) issues.push(`${agent}: Missing GATEWAY_URL`);
      if (!config[`${prefix}_GATEWAY_TOKEN`]) issues.push(`${agent}: Missing GATEWAY_TOKEN`);
      if (!config[`${prefix}_DISPLAY_NAME`]) warnings.push(`${agent}: Missing DISPLAY_NAME - may cause self-reply issues`);
      
      // Check if token file exists
      const tokenFile = config[`${prefix}_TOKEN_FILE`];
      if (tokenFile && !fs.existsSync(tokenFile)) {
        issues.push(`${agent}: Token file not found: ${tokenFile}`);
      }
    }
    
    res.json({
      ok: issues.length === 0,
      valid: issues.length === 0,
      issues,
      warnings,
      agentCount: enabledAgents.length
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/restart
 * Request middleware restart (sends SIGHUP to self)
 */
router.post('/restart', (req, res) => {
  res.json({
    ok: true,
    message: 'Restart requested. The middleware will restart shortly.',
    note: 'If running as systemd service, use: systemctl --user restart ms-middleware'
  });
  
  // Schedule restart after response is sent
  setTimeout(() => {
    console.log('Restart requested via API - exiting for systemd restart');
    process.exit(0);
  }, 1000);
});

/**
 * GET /api/info
 * Get middleware info and capabilities
 */
router.get('/info', (req, res) => {
  const pkg = require('../../package.json');
  
  res.json({
    ok: true,
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    capabilities: [
      'teams-messages',
      'teams-presence',
      'email-notifications',
      'calendar-notifications',
      'session-history',
      'cloudflare-tunnel'
    ],
    endpoints: {
      health: 'GET /health',
      status: 'GET /status/:agent',
      config: 'GET /api/config',
      agents: 'GET /api/config/agents',
      sessions: 'GET /sessions',
      webhooks: {
        teams: 'POST /webhook/teams/:agent',
        email: 'POST /webhook/email/:agent',
        calendar: 'POST /webhook/calendar/:agent'
      }
    }
  });
});

module.exports = router;
