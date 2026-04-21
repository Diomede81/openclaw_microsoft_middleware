/**
 * Token Management API
 * REST endpoints for managing agent Microsoft 365 tokens
 * Allows adding, updating, and refreshing tokens via API instead of environment variables
 */

const express = require('express');
const path = require('path');
const TokenManager = require('../token-manager');

const router = express.Router();

// Initialize token manager
const tokenManager = new TokenManager({
  tokenDbPath: process.env.TOKEN_DB_PATH || null
});

/**
 * POST /api/tokens/add
 * Add or update a token for an agent
 * 
 * Body:
 * {
 *   "agent": "kim",
 *   "accessToken": "...",
 *   "refreshToken": "...",
 *   "expiresIn": 3600,
 *   "scope": "Mail.Read Mail.Send ...",
 *   "tokenType": "Bearer"
 * }
 */
router.post('/add', (req, res) => {
  try {
    const { agent, accessToken, refreshToken, expiresIn, scope, tokenType } = req.body;

    // Validation
    if (!agent || !accessToken || !refreshToken) {
      return res.status(400).json({
        success: false,
        error: {
          type: 'validation',
          message: 'Missing required fields: agent, accessToken, refreshToken',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Store token
    tokenManager.setTokens(agent, {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn || 3600,
      obtained_at: Math.floor(Date.now() / 1000),
      token_type: tokenType || 'Bearer',
      scope: scope || 'Mail.Read Mail.Send Calendar.ReadWrite Teams.ReadWrite'
    });

    res.json({
      success: true,
      message: `Token added for agent '${agent}'`,
      agent,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error adding token:', err);
    res.status(500).json({
      success: false,
      error: {
        type: 'server',
        message: err.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

/**
 * GET /api/tokens/status/:agent
 * Check token status for an agent
 */
router.get('/status/:agent', (req, res) => {
  try {
    const { agent } = req.params;
    let token;
    try {
      token = tokenManager.getTokens(agent);
    } catch (err) {
      return res.status(404).json({
        success: false,
        error: {
          type: 'not_found',
          message: `No token found for agent '${agent}'`,
          timestamp: new Date().toISOString()
        }
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const obtainedAt = token.obtained_at ? Math.floor(token.obtained_at / 1000) : now;
    const expiresIn = token.expires_in || 3600;
    const expiresAt = obtainedAt + expiresIn;
    const isValid = expiresAt > now;

    res.json({
      success: true,
      agent,
      valid: isValid,
      expiresAt,
      expiresIn: Math.max(0, expiresAt - now),
      obtainedAt,
      scope: token.scope,
      tokenType: token.token_type,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error checking token status:', err);
    res.status(500).json({
      success: false,
      error: {
        type: 'server',
        message: err.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

/**
 * GET /api/tokens
 * List all agents with token status
 */
router.get('/', (req, res) => {
  try {
    const agents = tokenManager.listAgents();
    const now = Math.floor(Date.now() / 1000);

    const agentStatuses = agents.map(agent => {
      try {
        const token = tokenManager.getTokens(agent);
        const obtainedAt = token?.obtained_at ? Math.floor(token.obtained_at / 1000) : now;
        const expiresIn = token?.expires_in || 3600;
        const expiresAt = obtainedAt + expiresIn;
        const isValid = expiresAt > now;

        return {
          agent,
          valid: isValid,
          expiresAt,
          expiresIn: Math.max(0, expiresAt - now),
          scope: token?.scope,
          tokenType: token?.token_type
        };
      } catch (err) {
        return {
          agent,
          valid: false,
          error: err.message
        };
      }
    });

    res.json({
      success: true,
      agents: agentStatuses,
      total: agents.length,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error listing agents:', err);
    res.status(500).json({
      success: false,
      error: {
        type: 'server',
        message: err.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

/**
 * DELETE /api/tokens/:agent
 * Remove token for an agent
 */
router.delete('/:agent', (req, res) => {
  try {
    const { agent } = req.params;
    tokenManager.deleteTokens(agent);

    res.json({
      success: true,
      message: `Token removed for agent '${agent}'`,
      agent,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error deleting token:', err);
    res.status(500).json({
      success: false,
      error: {
        type: 'server',
        message: err.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

module.exports = router;
