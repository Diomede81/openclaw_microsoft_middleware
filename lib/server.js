#!/usr/bin/env node
/**
 * Microsoft 365 Integration Server
 * Centralized Teams, Email, and Calendar management for all OpenClaw agents
 * Port: 3007
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

// Load .env from cwd first, then package directory
const cwdEnv = path.join(process.cwd(), '.env');
const pkgEnv = path.join(__dirname, '..', '.env');
if (fs.existsSync(cwdEnv)) {
  require('dotenv').config({ path: cwdEnv });
} else if (fs.existsSync(pkgEnv)) {
  require('dotenv').config({ path: pkgEnv });
} else {
  require('dotenv').config();
}
const SubscriptionManager = require('./subscription-manager');
const { handleCalendarNotification } = require('./webhooks/calendar-handler');
const SessionStore = require('./sessions/store');
const configApi = require('./api/config');
const TokenManager = require('./token-manager');
const AttachmentDownloader = require('./attachments/downloader');
const { ErrorTypes, buildError } = require('./utils/error-handler');

const app = express();
const PORT = process.env.PORT || 3007;

// Mount configuration API
app.use('/api', configApi);

// Initialize session store for conversation history
const sessionStore = new SessionStore({
  maxMessages: parseInt(process.env.SESSION_MAX_MESSAGES) || 30,
  injectMessages: parseInt(process.env.SESSION_INJECT_MESSAGES) || 10,
  dbPath: process.env.SESSION_DB_PATH || path.join(process.cwd(), 'data', 'sessions.db')
});

// Initialize token manager (SQLite or file-based)
const tokenManager = new TokenManager({
  tokenDbPath: process.env.TOKEN_DB_PATH || null
});

// Initialize attachment downloader
const attachmentDownloader = new AttachmentDownloader({
  tokenManager: tokenManager,
  downloadDir: process.env.ATTACHMENT_DIR || path.join(process.cwd(), 'data', 'attachments')
});

// Load subscription configurations
const subscriptionConfigs = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'config', 'subscriptions.json'), 'utf8')
);

// Build agent configurations from environment variables
const AGENTS = {};

// Helper to load agent config from env
function loadAgentConfig(agentName) {
  const prefix = agentName.toUpperCase();
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]; // Optional
  const tenantId = process.env[`${prefix}_TENANT_ID`];
  const tokenFile = process.env[`${prefix}_TOKEN_FILE`];
  const gatewayUrl = process.env[`${prefix}_GATEWAY_URL`];
  const gatewayToken = process.env[`${prefix}_GATEWAY_TOKEN`];
  const displayName = process.env[`${prefix}_DISPLAY_NAME`];
  const agentId = process.env[`${prefix}_AGENT_ID`] || agentName;
  
  // Only create agent config if required fields exist
  // tokenFile is optional when using TOKEN_DB_PATH (SQLite storage)
  const usingDatabase = !!process.env.TOKEN_DB_PATH;
  const hasTokenSource = usingDatabase || tokenFile;
  
  if (clientId && tenantId && hasTokenSource && gatewayUrl && gatewayToken && displayName) {
    const config = {
      name: agentName.charAt(0).toUpperCase() + agentName.slice(1),
      displayName,
      userId: null, // Will be fetched from /me at startup
      clientId,
      tenantId,
      tokenFile,
      gatewayUrl,
      gatewayToken,
      agentId
    };
    
    // Add client secret if provided (for confidential client apps)
    if (clientSecret) {
      config.clientSecret = clientSecret;
    }
    
    return config;
  }
  return null;
}

// Load all agents from env (MAX_, SOPHIA_, KIM_, etc.)
const agentNames = new Set();
for (const key in process.env) {
  const match = key.match(/^([A-Z]+)_CLIENT_ID$/);
  if (match) {
    agentNames.add(match[1].toLowerCase());
  }
}

for (const agentName of agentNames) {
  const config = loadAgentConfig(agentName);
  if (config) {
    AGENTS[agentName] = config;
    console.log(`[${agentName}] Loaded from environment`);
  }
}

// State file for tracking subscription times and seen messages
const STATE_FILE = path.join(__dirname, 'middleware-state.json');
function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  }
  return { agents: {} };
}
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
let middlewareState = loadState();

// Initialize subscription managers for each agent
const subscriptionManagers = {};

for (const [agentName, agentConfig] of Object.entries(AGENTS)) {
  if (subscriptionConfigs[agentName]) {
    subscriptionManagers[agentName] = new SubscriptionManager({
      agentName,
      clientId: agentConfig.clientId,
      tenantId: agentConfig.tenantId,
      tokenFile: agentConfig.tokenFile,
      tokenManager: tokenManager,  // Pass shared TokenManager instance
      webhookBaseUrl: 'https://microsoft.acuity.expert',
      subscriptions: subscriptionConfigs[agentName]
    });
  }
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ==================== TOKEN MANAGEMENT ====================

/**
 * Get valid access token for an agent
 * Auto-refreshes if expired or expiring soon
 */
async function getAccessToken(agent) {
  const config = AGENTS[agent];
  if (!config) throw new Error(`Unknown agent: ${agent}`);
  
  // Read current tokens via TokenManager
  let tokens;
  try {
    tokens = tokenManager.getTokens(agent, config.tokenFile);
  } catch (error) {
    throw new Error(`Failed to read tokens for ${agent}: ${error.message}`);
  }
  
  // Validate token structure
  if (!tokens.refresh_token) {
    throw new Error(`No refresh_token found for ${agent}. Re-authenticate required.`);
  }
  
  // Check if token is still valid (5 min buffer)
  const expiresAt = tokens.obtained_at + (tokens.expires_in * 1000);
  const needsRefresh = Date.now() > expiresAt - 300000;
  
  if (!needsRefresh) {
    return tokens.access_token;
  }
  
  // Token needs refresh
  console.log(`[${agent}] Access token expired or expiring soon, refreshing...`);
  
  const tokenParams = {
    client_id: config.clientId,
    refresh_token: tokens.refresh_token,
    grant_type: 'refresh_token',
    scope: 'https://graph.microsoft.com/.default'
  };
  
  // Add client secret if available (required for confidential clients)
  if (config.clientSecret) {
    tokenParams.client_secret = config.clientSecret;
  }
  
  try {
    const response = await fetch(
      `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(tokenParams)
      }
    );
    
    const newTokens = await response.json();
    
    if (newTokens.error) {
      console.error(`[${agent}] Token refresh failed:`, newTokens.error_description);
      throw new Error(`Token refresh failed: ${newTokens.error_description}`);
    }
    
    // Validate new tokens
    if (!newTokens.access_token || !newTokens.refresh_token) {
      throw new Error('Token response missing required fields');
    }
    
    // Preserve original fields and add new tokens
    const updatedTokens = {
      ...tokens,
      ...newTokens,
      obtained_at: Date.now()
    };
    
    // Save via TokenManager (handles both file and DB)
    tokenManager.setTokens(agent, updatedTokens, config.tokenFile);
    
    console.log(`[${agent}] ✓ Token refreshed successfully (expires in ${updatedTokens.expires_in}s)`);
    
    return updatedTokens.access_token;
    
  } catch (error) {
    console.error(`[${agent}] Token refresh error:`, error.message);
    
    // If token refresh fails, throw error (don't use expired token)
    throw new Error(`Cannot refresh token for ${agent}: ${error.message}`);
  }
}

/**
 * Parse Microsoft Graph API error response
 * @param {Response} response - Fetch response object
 * @param {string} resource - Resource type for context (e.g., 'event', 'message')
 * @returns {Object} Formatted error object
 */
async function parseGraphError(response, resource = 'resource') {
  const status = response.status;
  let errorData;
  
  try {
    errorData = await response.json();
  } catch {
    errorData = { error: { message: await response.text() } };
  }
  
  const message = errorData.error?.message || `HTTP ${status}`;
  
  // Map common status codes to actionable errors
  switch (status) {
    case 401:
      return buildError('authentication', 'Access token is invalid or expired', {
        action: 'Token should auto-refresh. If this persists, re-authenticate the agent.',
        details: message
      });
    
    case 403:
      const permission = errorData.error?.message?.match(/permission[s]?:\s*([^,\.]+)/i)?.[1];
      return buildError('authorization', `Permission denied${permission ? ': ' + permission : ''}`, {
        action: 'Add required permission in Azure AD app registration and re-authenticate',
        details: message
      });
    
    case 404:
      return buildError('not_found', `${resource} not found`, {
        action: 'Verify the ID is correct and the resource still exists',
        details: message
      });
    
    case 429:
      return buildError('rate_limit', 'Microsoft Graph API rate limit exceeded', {
        action: 'Wait 60 seconds and retry. Reduce request frequency if this persists.',
        details: message
      });
    
    case 400:
      return buildError('validation', 'Invalid request to Microsoft Graph API', {
        action: 'Check request parameters and format',
        details: message
      });
    
    case 500:
    case 503:
      return buildError('graph_service', `Microsoft Graph API service error (${status})`, {
        action: 'This is a Microsoft service issue. Check https://status.cloud.microsoft/ and retry later.',
        details: message
      });
    
    default:
      return buildError('graph_api', `Microsoft Graph API error (${status})`, {
        action: 'Check the details below and adjust your request',
        details: message
      });
  }
}

/**
 * Set agent presence status in Teams
 * @param {string} agent - Agent name
 * @param {string} availability - Available, Busy, DoNotDisturb, Away, Offline
 * @param {string} activity - Available, Busy, DoNotDisturb, Away, OffWork, etc.
 */
async function setPresence(agent, availability = 'Available', activity = 'Available') {
  const config = AGENTS[agent];
  if (!config) return;
  
  try {
    const token = await getAccessToken(agent);
    
    const response = await fetch(
      'https://graph.microsoft.com/v1.0/me/presence/setPresence',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sessionId: config.clientId,
          availability: availability,
          activity: activity,
          expirationDuration: 'PT4H' // 4 hours
        })
      }
    );
    
    if (response.ok) {
      console.log(`[${agent}] Presence set to ${availability}`);
    } else {
      const err = await response.json();
      console.log(`[${agent}] Presence update failed: ${err.error?.message || response.status}`);
    }
  } catch (error) {
    console.log(`[${agent}] Presence error: ${error.message}`);
  }
}

/**
 * Initialize presence for all agents on startup
 */
async function initializePresence() {
  console.log('Initializing agent presence...');
  for (const agent of Object.keys(AGENTS)) {
    await setPresence(agent, 'Available', 'Available');
  }
}

// ==================== TEAMS ====================

// Webhook for Teams notifications
app.post('/webhook/teams/:agent', async (req, res) => {
  const { agent } = req.params;
  const config = AGENTS[agent];
  
  if (!config) {
    return res.status(404).json({ error: 'Unknown agent' });
  }
  
  // Handle Microsoft validation
  const validationToken = req.query.validationToken;
  if (validationToken) {
    console.log(`[${agent}] Teams webhook validation`);
    return res.status(200).type('text/plain').send(validationToken);
  }
  
  // Handle notifications
  try {
    const notifications = req.body.value || [];
    console.log(`[${agent}] Received ${notifications.length} Teams notifications`);
    
    for (const notification of notifications) {
      if (notification.changeType !== 'created') continue;
      
      const resource = notification.resource || '';
      const match = resource.match(/chats\('([^']+)'\)\/messages\('([^']+)'\)/);
      
      if (match) {
        const [, chatId, messageId] = match;
        const token = await getAccessToken(agent);
        
        // Fetch message details
        const msgResp = await fetch(
          `https://graph.microsoft.com/v1.0/me/chats/${chatId}/messages/${messageId}`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        const message = await msgResp.json();
        
        // Get sender display name for later use
        const fromDisplayName = message.from?.user?.displayName;
        // NOTE: Own message filtering moved to FILTER 6 which also stores the message for context
        
        // FILTER 2: Skip messages older than middleware start time
        // This prevents processing backfill messages from subscription creation
        if (!middlewareState.agents[agent]) {
          middlewareState.agents[agent] = {
            startTime: new Date().toISOString(),
            seenMessageIds: []
          };
          saveState(middlewareState);
        }
        const messageTime = new Date(message.createdDateTime);
        const startTime = new Date(middlewareState.agents[agent].startTime);
        if (messageTime < startTime) {
          console.log(`[${agent}] Skipping old message from ${messageTime.toISOString()} (before start time ${startTime.toISOString()})`);
          continue;
        }
        
        // FILTER 3: Deduplicate - skip if already seen
        if (middlewareState.agents[agent].seenMessageIds.includes(messageId)) {
          console.log(`[${agent}] Skipping duplicate message ${messageId}`);
          continue;
        }
        // Add to seen list (keep last 1000 to prevent unbounded growth)
        middlewareState.agents[agent].seenMessageIds.push(messageId);
        if (middlewareState.agents[agent].seenMessageIds.length > 1000) {
          middlewareState.agents[agent].seenMessageIds = 
            middlewareState.agents[agent].seenMessageIds.slice(-1000);
        }
        saveState(middlewareState);
        
        // FILTER 4: Group chat check - fetch chat details
        const chatResp = await fetch(
          `https://graph.microsoft.com/v1.0/me/chats/${chatId}`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        const chat = await chatResp.json();
        const isGroupChat = chat.chatType === 'group';
        
        // FILTER 5: If group chat, check if agent is @mentioned
        if (isGroupChat) {
          const mentions = message.mentions || [];
          
          // Check by user ID (most reliable) or displayName
          // Mentions can split names ("Max" + "Ferretti") so check if ANY mention matches
          const agentMentioned = mentions.some(m => {
            const mentionedUser = m.mentioned?.user;
            if (!mentionedUser) return false;
            
            // Check 1: User ID match (if we have it)
            if (config.userId && mentionedUser.id === config.userId) {
              return true;
            }
            
            // Check 2: DisplayName contains any part of our name
            const mentionedName = mentionedUser.displayName?.toLowerCase() || '';
            const ourName = config.displayName.toLowerCase();
            const nameParts = ourName.split(' ');
            
            // If mentioned name matches full name or any part of it
            return mentionedName === ourName || nameParts.some(part => mentionedName === part);
          });
          
          if (!agentMentioned) {
            console.log(`[${agent}] Skipping group chat message (not @mentioned). Chat: ${chat.topic || 'Unnamed'}`);
            continue;
          }
          
          console.log(`[${agent}] 🎯 Group chat message where I'm @mentioned! Chat: ${chat.topic || 'Unnamed'}`);
        }
        
        const content = message.body?.content?.replace(/<[^>]*>/g, '').trim() || '';
        const from = fromDisplayName || 'Unknown';
        const chatTypeLabel = isGroupChat ? 'GROUP' : '1:1';
        const chatType = isGroupChat ? 'group' : 'direct'; // For session key
        
        // Check for attachments and download them
        const attachments = message.attachments || [];
        let attachmentInfo = '';
        let downloadedFiles = [];
        
        if (attachments.length > 0) {
          console.log(`[${agent}] Message has ${attachments.length} attachment(s)`);
          
          // Download attachments via Graph API
          try {
            downloadedFiles = await attachmentDownloader.downloadAllAttachments(attachments, {
              agentName: agent,
              tokenFile: config.tokenFile,
              tenantId: config.tenantId,
              clientId: config.clientId
            });
            
            attachmentInfo = '\n\n📎 Attachments:\n';
            for (const file of downloadedFiles) {
              if (file.error) {
                attachmentInfo += `- ${file.name} (${file.contentType}) - ⚠️ Download failed: ${file.error}\n`;
              } else {
                attachmentInfo += `- ${file.name} (${file.contentType}, ${file.size} bytes)\n`;
                attachmentInfo += `  📁 Local path: ${file.path}\n`;
              }
            }
          } catch (downloadError) {
            console.error(`[${agent}] Attachment download error:`, downloadError.message);
            attachmentInfo = '\n\n📎 Attachments:\n';
            for (const attachment of attachments) {
              const name = attachment.name || 'Unknown';
              const contentType = attachment.contentType || 'unknown';
              attachmentInfo += `- ${name} (${contentType}) - ⚠️ Could not download\n`;
            }
          }
        }
        
        console.log(`[${agent}] [${chatTypeLabel}] Teams message from ${from}: ${content.substring(0, 50)}...`);
        
        // FILTER 6: Skip messages sent by the agent itself (prevent self-reply loops)
        // Primary check: User ID (most reliable, never changes)
        // Fallback: Display name (less reliable, can change or mismatch)
        const messageUserId = message.from?.user?.id;
        const isOwnMessage = (config.userId && messageUserId === config.userId) || 
                             (!messageUserId && from === config.displayName);
        
        if (isOwnMessage) {
          console.log(`[${agent}] Skipping own message (userId: ${messageUserId || 'n/a'}, displayName: ${from})`);
          
          // Still store agent's own message for context (but don't forward to gateway)
          const storeSessionKey = SessionStore.makeSessionKey('teams', agent, chatId);
          sessionStore.getOrCreateSession('teams', agent, chatId, { chatType, displayName: config.displayName });
          sessionStore.addMessage(storeSessionKey, 'assistant', content, config.displayName, message.id);
          
          continue;
        }
        
        // === SESSION HISTORY MANAGEMENT ===
        // Get or create session for this chat
        const storeSessionKey = SessionStore.makeSessionKey('teams', agent, chatId);
        sessionStore.getOrCreateSession('teams', agent, chatId, { chatType, displayName: config.displayName });
        
        // Store incoming user message
        sessionStore.addMessage(storeSessionKey, 'user', content, from, message.id);
        
        // Get conversation history for context injection
        const historyContext = sessionStore.formatMessagesForPrompt(storeSessionKey);
        const messageCount = sessionStore.getRecentMessages(storeSessionKey).length;
        
        // Format message text with agent-specific reply command
        const replyScript = agent === 'sophia' 
          ? 'node sophia-teams-reply.js' 
          : agent === 'kim'
          ? 'node kim-teams-reply.js'
          : 'node ~/clawd/memory/projects/microsoft-integration/scripts/max-teams-reply.js';
        
        // Build wake text with optional history context
        let wakeText = '';
        if (historyContext && messageCount > 1) {
          wakeText = `${historyContext}`;
        }
        wakeText += `💬 Teams message from ${from}: "${content}"${attachmentInfo}\n\nChat ID: ${chatId}\n\nPlease respond to this Teams message using:\n${replyScript} "${chatId}" "<your reply in HTML format>"`;
        
        // Create persistent session key matching OpenClaw's format
        // Format: agent:{agentId}:{channel}:{chatType}:{chatId}
        // This maintains conversation context across messages, like WhatsApp sessions
        const persistentSessionKey = `agent:${config.agentId}:teams:${chatType}:${chatId}`;
        
        // Forward to agent gateway using /hooks/agent endpoint
        // sessionKey will create persistent session per chat (format: agent:max:teams:direct:chatId)
        const payload = {
          message: wakeText,
          agentId: config.agentId,
          sessionKey: persistentSessionKey,
          deliver: true
        };
        
        console.log(`[${agent}] Forwarding to ${config.gatewayUrl} with sessionKey: ${persistentSessionKey} (${messageCount} msgs in history)`);
        const fwdResp = await fetch(config.gatewayUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.gatewayToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
        const fwdResult = await fwdResp.text();
        console.log(`[${agent}] Gateway response: ${fwdResult.substring(0, 100)}`);
      }
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error(`[${agent}] Teams webhook error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Send Teams message
app.post('/api/teams/send', async (req, res) => {
  const { agent, chatId, message, attachments } = req.body;
  
  // Validate required fields
  if (!agent || !chatId || !message) {
    return res.status(400).json(ErrorTypes.VALIDATION_MISSING_FIELDS(['agent', 'chatId', 'message']));
  }
  
  // Validate agent exists
  if (!AGENTS[agent]) {
    return res.status(404).json(ErrorTypes.VALIDATION_INVALID_AGENT(agent, Object.keys(AGENTS)));
  }
  
  try {
    const token = await getAccessToken(agent);
    
    const messagePayload = {
      body: {
        contentType: 'html',
        content: message
      }
    };
    
    // Add attachments if provided
    if (attachments && attachments.length > 0) {
      messagePayload.attachments = attachments.map(att => ({
        id: att.id || crypto.randomUUID(),
        contentType: att.contentType || 'reference',
        contentUrl: att.contentUrl,
        name: att.name
      }));
    }
    
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/chats/${chatId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(messagePayload)
      }
    );
    
    if (response.status === 201) {
      const sent = await response.json();
      console.log(`[${agent}] Sent Teams message to ${chatId}${attachments?.length ? ` with ${attachments.length} attachment(s)` : ''}`);
      
      // Update presence to Available after sending message
      try {
        const agentConfig = AGENTS[agent];
        const presenceResponse = await fetch('https://graph.microsoft.com/v1.0/me/presence/setPresence', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            sessionId: agentConfig.clientId, // Must match the application ID
            availability: 'Available',
            activity: 'Available',
            expirationDuration: 'PT4H' // 4 hours
          })
        });
        
        if (presenceResponse.ok) {
          console.log(`[${agent}] Updated presence to Available`);
        } else {
          const errorText = await presenceResponse.text();
          console.warn(`[${agent}] Presence update failed (${presenceResponse.status}): ${errorText}`);
        }
      } catch (presenceError) {
        console.warn(`[${agent}] Could not update presence:`, presenceError.message);
      }
      
      res.json({ success: true, messageId: sent.id });
    } else {
      // Parse Graph API error
      const graphError = await parseGraphError(response, 'Teams message');
      return res.status(response.status).json(graphError);
    }
  } catch (error) {
    console.error(`[${agent}] Teams send error:`, error.message);
    
    // Check if it's an auth error
    if (error.message.includes('token') || error.message.includes('auth')) {
      return res.status(401).json(ErrorTypes.AUTH_TOKEN_EXPIRED(agent));
    }
    
    // Generic server error
    res.status(500).json(ErrorTypes.SERVER_ERROR(`Failed to send Teams message: ${error.message}`, error));
  }
});

// Upload file to OneDrive and get sharing link for Teams
app.post('/api/teams/upload', async (req, res) => {
  const { agent, fileName, fileContent, contentType } = req.body;
  
  if (!agent || !fileName || !fileContent) {
    return res.status(400).json({ error: 'Missing required fields: agent, fileName, fileContent' });
  }
  
  try {
    const token = await getAccessToken(agent);
    
    // Upload to OneDrive
    const uploadPath = `/me/drive/root:/TeamsAttachments/${fileName}:/content`;
    const buffer = Buffer.from(fileContent, 'base64');
    
    const uploadResp = await fetch(
      `https://graph.microsoft.com/v1.0${uploadPath}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': contentType || 'application/octet-stream'
        },
        body: buffer
      }
    );
    
    if (!uploadResp.ok) {
      throw new Error(`Upload failed: ${await uploadResp.text()}`);
    }
    
    const file = await uploadResp.json();
    
    // Create sharing link
    const shareResp = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/items/${file.id}/createLink`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 'view',
          scope: 'organization'
        })
      }
    );
    
    const shareLink = await shareResp.json();
    
    console.log(`[${agent}] Uploaded file: ${fileName} (${file.size} bytes)`);
    
    res.json({
      success: true,
      fileId: file.id,
      fileName: file.name,
      webUrl: file.webUrl,
      shareUrl: shareLink.link?.webUrl
    });
    
  } catch (error) {
    console.error(`[${agent}] Upload error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// ==================== EMAIL ====================

// List emails
app.get('/api/email/list/:agent', async (req, res) => {
  const { agent } = req.params;
  const limit = parseInt(req.query.limit) || 10;
  
  // Validate agent exists
  if (!AGENTS[agent]) {
    return res.status(404).json(ErrorTypes.VALIDATION_INVALID_AGENT(agent, Object.keys(AGENTS)));
  }
  
  try {
    const token = await getAccessToken(agent);
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages?$top=${limit}&$select=id,subject,from,receivedDateTime,bodyPreview,isRead`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    
    if (response.ok) {
      const data = await response.json();
      res.json(data.value || []);
    } else {
      const graphError = await parseGraphError(response, 'emails');
      return res.status(response.status).json(graphError);
    }
  } catch (error) {
    console.error(`[${agent}] Email list error:`, error.message);
    
    if (error.message.includes('token') || error.message.includes('auth')) {
      return res.status(401).json(ErrorTypes.AUTH_TOKEN_EXPIRED(agent));
    }
    
    res.status(500).json(ErrorTypes.SERVER_ERROR(`Failed to list emails: ${error.message}`, error));
  }
});

// Read email
app.get('/api/email/read/:agent/:messageId', async (req, res) => {
  const { agent, messageId } = req.params;
  
  try {
    const token = await getAccessToken(agent);
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error(`[${agent}] Email read error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Send email
app.post('/api/email/send', async (req, res) => {
  const { agent, to, subject, body } = req.body;
  
  if (!agent || !to || !subject || !body) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  try {
    const token = await getAccessToken(agent);
    const response = await fetch(
      'https://graph.microsoft.com/v1.0/me/sendMail',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: {
            subject,
            toRecipients: [{ emailAddress: { address: to } }],
            body: { contentType: 'HTML', content: body }
          }
        })
      }
    );
    
    if (response.status === 202) {
      console.log(`[${agent}] Sent email to ${to}`);
      res.json({ success: true });
    } else {
      throw new Error(`Failed: ${response.status}`);
    }
  } catch (error) {
    console.error(`[${agent}] Email send error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Reply to email
app.post('/api/email/reply', async (req, res) => {
  const { agent, messageId, body, replyAll } = req.body;
  
  if (!agent || !messageId || !body) {
    return res.status(400).json({ error: 'Missing required fields: agent, messageId, body' });
  }
  
  try {
    const token = await getAccessToken(agent);
    const endpoint = replyAll ? 'replyAll' : 'reply';
    
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}/${endpoint}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: {
            body: { contentType: 'HTML', content: body }
          }
        })
      }
    );
    
    if (response.status === 202) {
      console.log(`[${agent}] Replied to email ${messageId}`);
      res.json({ success: true });
    } else {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `Failed: ${response.status}`);
    }
  } catch (error) {
    console.error(`[${agent}] Email reply error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Forward email
app.post('/api/email/forward', async (req, res) => {
  const { agent, messageId, to, comment } = req.body;
  
  if (!agent || !messageId || !to) {
    return res.status(400).json({ error: 'Missing required fields: agent, messageId, to' });
  }
  
  try {
    const token = await getAccessToken(agent);
    
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}/forward`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          comment: comment || '',
          toRecipients: [{ emailAddress: { address: to } }]
        })
      }
    );
    
    if (response.status === 202) {
      console.log(`[${agent}] Forwarded email ${messageId} to ${to}`);
      res.json({ success: true });
    } else {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `Failed: ${response.status}`);
    }
  } catch (error) {
    console.error(`[${agent}] Email forward error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Delete email
app.delete('/api/email/:agent/:messageId', async (req, res) => {
  const { agent, messageId } = req.params;
  
  try {
    const token = await getAccessToken(agent);
    
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      }
    );
    
    if (response.status === 204) {
      console.log(`[${agent}] Deleted email ${messageId}`);
      res.json({ success: true });
    } else {
      throw new Error(`Failed: ${response.status}`);
    }
  } catch (error) {
    console.error(`[${agent}] Email delete error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Search emails
app.get('/api/email/search/:agent', async (req, res) => {
  const { agent } = req.params;
  const { q, folder, top } = req.query;
  
  if (!q) {
    return res.status(400).json({ error: 'Missing search query (q)' });
  }
  
  try {
    const token = await getAccessToken(agent);
    const limit = parseInt(top) || 10;
    const folderPath = folder || 'inbox';
    
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/mailFolders/${folderPath}/messages?$search="${encodeURIComponent(q)}"&$top=${limit}&$select=id,subject,from,receivedDateTime,bodyPreview,isRead`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    
    const data = await response.json();
    res.json(data.value || []);
  } catch (error) {
    console.error(`[${agent}] Email search error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// ==================== CALENDAR ====================

// List calendar events
app.get('/api/calendar/list/:agent', async (req, res) => {
  const { agent } = req.params;
  const days = parseInt(req.query.days) || 7;
  
  // Validate agent exists
  if (!AGENTS[agent]) {
    return res.status(404).json(ErrorTypes.VALIDATION_INVALID_AGENT(agent, Object.keys(AGENTS)));
  }
  
  try {
    const token = await getAccessToken(agent);
    const startDate = new Date().toISOString();
    const endDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${startDate}&endDateTime=${endDate}&$select=subject,start,end,location,onlineMeeting,isOnlineMeeting&$orderby=start/dateTime`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    
    if (response.ok) {
      const data = await response.json();
      res.json(data.value || []);
    } else {
      const graphError = await parseGraphError(response, 'calendar events');
      return res.status(response.status).json(graphError);
    }
  } catch (error) {
    console.error(`[${agent}] Calendar list error:`, error.message);
    
    if (error.message.includes('token') || error.message.includes('auth')) {
      return res.status(401).json(ErrorTypes.AUTH_TOKEN_EXPIRED(agent));
    }
    
    res.status(500).json(ErrorTypes.SERVER_ERROR(`Failed to list calendar events: ${error.message}`, error));
  }
});

// Create calendar event
app.post('/api/calendar/create', async (req, res) => {
  const { agent, subject, start, end, location, attendees } = req.body;
  
  if (!agent || !subject || !start || !end) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  try {
    const token = await getAccessToken(agent);
    const event = {
      subject,
      start: { dateTime: start, timeZone: 'Europe/London' },
      end: { dateTime: end, timeZone: 'Europe/London' }
    };
    
    if (location) event.location = { displayName: location };
    if (attendees && Array.isArray(attendees)) {
      event.attendees = attendees.map(email => ({
        emailAddress: { address: email },
        type: 'required'
      }));
    }
    
    const response = await fetch(
      'https://graph.microsoft.com/v1.0/me/calendar/events',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(event)
      }
    );
    
    if (response.status === 201) {
      const data = await response.json();
      console.log(`[${agent}] Created calendar event: ${subject}`);
      res.json({ success: true, eventId: data.id });
    } else {
      throw new Error(`Failed: ${response.status}`);
    }
  } catch (error) {
    console.error(`[${agent}] Calendar create error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get single calendar event
app.get('/api/calendar/event/:agent/:eventId', async (req, res) => {
  const { agent, eventId } = req.params;
  
  try {
    const token = await getAccessToken(agent);
    
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/events/${eventId}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    
    if (response.ok) {
      const data = await response.json();
      res.json(data);
    } else {
      throw new Error(`Failed: ${response.status}`);
    }
  } catch (error) {
    console.error(`[${agent}] Calendar get event error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Update calendar event
app.put('/api/calendar/event/:agent/:eventId', async (req, res) => {
  const { agent, eventId } = req.params;
  const { subject, start, end, location, attendees, body } = req.body;
  
  try {
    const token = await getAccessToken(agent);
    
    const updates = {};
    if (subject) updates.subject = subject;
    if (start) updates.start = { dateTime: start, timeZone: 'Europe/London' };
    if (end) updates.end = { dateTime: end, timeZone: 'Europe/London' };
    if (location) updates.location = { displayName: location };
    if (body) updates.body = { contentType: 'HTML', content: body };
    if (attendees && Array.isArray(attendees)) {
      updates.attendees = attendees.map(email => ({
        emailAddress: { address: email },
        type: 'required'
      }));
    }
    
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/events/${eventId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updates)
      }
    );
    
    if (response.ok) {
      const data = await response.json();
      console.log(`[${agent}] Updated calendar event: ${eventId}`);
      res.json({ success: true, event: data });
    } else {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `Failed: ${response.status}`);
    }
  } catch (error) {
    console.error(`[${agent}] Calendar update error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Delete calendar event
app.delete('/api/calendar/event/:agent/:eventId', async (req, res) => {
  const { agent, eventId } = req.params;
  
  try {
    const token = await getAccessToken(agent);
    
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/events/${eventId}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      }
    );
    
    if (response.status === 204) {
      console.log(`[${agent}] Deleted calendar event: ${eventId}`);
      res.json({ success: true });
    } else {
      throw new Error(`Failed: ${response.status}`);
    }
  } catch (error) {
    console.error(`[${agent}] Calendar delete error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Search calendar events
app.get('/api/calendar/search/:agent', async (req, res) => {
  const { agent } = req.params;
  const { q, days } = req.query;
  
  if (!q) {
    return res.status(400).json({ error: 'Missing search query (q)' });
  }
  
  try {
    const token = await getAccessToken(agent);
    const startDate = new Date().toISOString();
    const daysAhead = parseInt(days) || 30;
    const endDate = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();
    
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${startDate}&endDateTime=${endDate}&$filter=contains(subject,'${encodeURIComponent(q)}')&$select=id,subject,start,end,location`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    
    const data = await response.json();
    res.json(data.value || []);
  } catch (error) {
    console.error(`[${agent}] Calendar search error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// ==================== CALENDAR WEBHOOKS ====================

// Calendar webhook notifications
app.post('/webhook/calendar/:agent', async (req, res) => {
  const { agent } = req.params;
  const config = AGENTS[agent];
  
  if (!config) {
    return res.status(404).json({ error: 'Unknown agent' });
  }
  
  // Handle Microsoft validation
  const validationToken = req.query.validationToken;
  if (validationToken) {
    console.log(`[${agent}] Calendar webhook validation`);
    return res.status(200).type('text/plain').send(validationToken);
  }
  
  // Check if calendar notifications are disabled
  if (process.env.FORWARD_CALENDAR_NOTIFICATIONS === 'false') {
    console.log(`[${agent}] Calendar notification received but forwarding is DISABLED`);
    return res.status(200).send('OK');
  }
  
  // Handle notifications
  try {
    const notifications = req.body.value || [];
    console.log(`[${agent}] Received ${notifications.length} calendar notifications`);
    
    for (const notification of notifications) {
      await handleCalendarNotification(agent, notification, getAccessToken, config);
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error(`[${agent}] Calendar webhook error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// ==================== EMAIL WEBHOOKS ====================

// Email webhook notifications
app.post('/webhook/email/:agent', async (req, res) => {
  const { agent } = req.params;
  const config = AGENTS[agent];
  
  if (!config) {
    return res.status(404).json({ error: 'Unknown agent' });
  }
  
  // Handle Microsoft validation
  const validationToken = req.query.validationToken;
  if (validationToken) {
    console.log(`[${agent}] Email webhook validation`);
    return res.status(200).type('text/plain').send(validationToken);
  }
  
  // Handle notifications
  try {
    const notifications = req.body.value || [];
    console.log(`[${agent}] Received ${notifications.length} email notifications`);
    
    for (const notification of notifications) {
      if (notification.changeType !== 'created') continue;
      
      const resourceId = notification.resourceData?.id;
      if (!resourceId) continue;
      
      const token = await getAccessToken(agent);
      
      // Fetch email details
      const emailResp = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages/${resourceId}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const email = await emailResp.json();
      
      const from = email.from?.emailAddress?.address || 'Unknown';
      const subject = email.subject || '(no subject)';
      const preview = email.bodyPreview?.substring(0, 200) || '';
      
      console.log(`[${agent}] New email from ${from}: ${subject}`);
      
      // Format email notification
      const wakeText = `📧 New email from ${from}\n\n**Subject:** ${subject}\n**Preview:** ${preview}\n\n---\nEmail ID: ${resourceId}`;
      
      // Forward to agent gateway
      const payload = config.agentId ? {
        // Agents with /hooks/agent endpoint
        message: wakeText,
        name: 'Email',
        agentId: config.agentId,
        // No sessionKey - let gateway auto-create ephemeral sessions
        // This prevents queueing issues when Microsoft sends duplicate webhooks
        deliver: true
      } : {
        // Legacy /hooks/wake endpoint
        text: wakeText
      };
      
      console.log(`[${agent}] Forwarding email to ${config.gatewayUrl}...`);
      const fwdResp = await fetch(config.gatewayUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.gatewayToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      const fwdResult = await fwdResp.text();
      console.log(`[${agent}] Gateway response: ${fwdResult.substring(0, 100)}`);
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error(`[${agent}] Email webhook error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// ==================== SUBSCRIPTIONS MANAGEMENT ====================

// List active subscriptions
app.get('/api/subscription/list/:agent', async (req, res) => {
  const { agent } = req.params;
  const manager = subscriptionManagers[agent];
  
  if (!manager) {
    return res.status(404).json({ error: 'Unknown agent' });
  }
  
  try {
    const subscriptions = await manager.listSubscriptions();
    res.json(subscriptions);
  } catch (error) {
    console.error(`[${agent}] List subscriptions error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Manual refresh of all subscriptions for an agent
app.post('/api/subscription/refresh/:agent', async (req, res) => {
  const { agent } = req.params;
  const manager = subscriptionManagers[agent];
  
  if (!manager) {
    return res.status(404).json({ error: 'Unknown agent' });
  }
  
  try {
    await manager.refreshAllSubscriptions();
    res.json({ success: true, message: 'All subscriptions refreshed' });
  } catch (error) {
    console.error(`[${agent}] Refresh subscriptions error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Delete a subscription
app.delete('/api/subscription/:agent/:subscriptionId', async (req, res) => {
  const { agent, subscriptionId } = req.params;
  const manager = subscriptionManagers[agent];
  
  if (!manager) {
    return res.status(404).json({ error: 'Unknown agent' });
  }
  
  try {
    await manager.deleteSubscription(subscriptionId);
    res.json({ success: true, message: 'Subscription deleted' });
  } catch (error) {
    console.error(`[${agent}] Delete subscription error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// ==================== SETUP INSTRUCTIONS ====================

app.get('/api/setup', async (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const setupPath = path.join(__dirname, '..', 'docs', 'AGENT_SETUP.md');
  
  try {
    const markdown = fs.readFileSync(setupPath, 'utf8');
    const sessionStats = sessionStore.getStats();
    
    // Check each agent's token status
    const agentStatus = {};
    for (const agent of Object.keys(AGENTS)) {
      try {
        const token = await getAccessToken(agent);
        agentStatus[agent] = { tokenValid: !!token };
      } catch {
        agentStatus[agent] = { tokenValid: false };
      }
    }
    
    res.json({
      instructions: markdown,
      currentStatus: {
        serviceRunning: true,
        agents: Object.keys(AGENTS),
        agentStatus,
        totalSessions: sessionStats.totalSessions || 0
      },
      quickStart: {
        step1: 'Run device auth: ms-middleware token-device <agent>',
        step2: 'Complete Microsoft sign-in in browser',
        step3: 'Verify with: curl http://localhost:3007/sessions',
        step4: 'Test email: curl http://localhost:3007/api/email/list/<agent>?top=1'
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Setup instructions not found', details: error.message });
  }
});

// ==================== HEALTH & STATUS ====================

app.get('/health', (req, res) => {
  const sessionStats = sessionStore.getStats();
  res.json({ 
    status: 'ok', 
    agents: Object.keys(AGENTS),
    sessions: sessionStats
  });
});

app.get('/status/:agent', async (req, res) => {
  const { agent } = req.params;
  
  try {
    const token = await getAccessToken(agent);
    const sessions = sessionStore.getAgentSessions(agent);
    res.json({ 
      agent, 
      tokenValid: !!token,
      sessions: sessions.map(s => ({
        sessionKey: s.session_key,
        channel: s.channel,
        messageCount: s.message_count,
        updatedAt: s.updated_at
      }))
    });
  } catch (error) {
    res.status(500).json({ agent, error: error.message });
  }
});

// Session management endpoints
app.get('/sessions', (req, res) => {
  const stats = sessionStore.getStats();
  res.json(stats);
});

app.get('/sessions/:agent', (req, res) => {
  const { agent } = req.params;
  const sessions = sessionStore.getAgentSessions(agent);
  res.json({ agent, sessions });
});

app.get('/sessions/:agent/:channel/:chatId', (req, res) => {
  const { agent, channel, chatId } = req.params;
  const sessionKey = SessionStore.makeSessionKey(channel, agent, chatId);
  const messages = sessionStore.getRecentMessages(sessionKey, 50);
  res.json({ sessionKey, messages });
});

app.delete('/sessions/:agent/:channel/:chatId', (req, res) => {
  const { agent, channel, chatId } = req.params;
  const sessionKey = SessionStore.makeSessionKey(channel, agent, chatId);
  sessionStore.clearSession(sessionKey);
  res.json({ ok: true, cleared: sessionKey });
});

// ==================== INITIALIZATION ====================

// Fetch user IDs for all agents at startup
async function initializeAgentUserIds() {
  for (const [agentName, config] of Object.entries(AGENTS)) {
    try {
      const token = await getAccessToken(agentName);
      const response = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const user = await response.json();
      
      if (user.id) {
        AGENTS[agentName].userId = user.id;
        console.log(`[${agentName}] Fetched user ID: ${user.id} (${user.displayName})`);
        
        // Verify displayName matches - warn if not (could cause filter issues)
        if (user.displayName && user.displayName !== config.displayName) {
          console.warn(`[${agentName}] ⚠️ DisplayName mismatch! Config: "${config.displayName}", Graph: "${user.displayName}"`);
          console.warn(`[${agentName}] ⚠️ Update ${agentName.toUpperCase()}_DISPLAY_NAME in .env to match Graph`);
        }
      } else {
        console.warn(`[${agentName}] ⚠️ Could not fetch user ID - self-message filtering will rely on displayName only!`);
      }
    } catch (error) {
      console.error(`[${agentName}] Error fetching user ID:`, error.message);
    }
  }
}

/**
 * Proactive token refresh timer
 * Checks and refreshes tokens regularly to prevent expiration
 * Ensures tokens stay fresh even if no API calls are made
 */
function startTokenRefreshTimer() {
  // Check every 15 minutes (more frequent than 30 min to catch tokens)
  const CHECK_INTERVAL = 15 * 60 * 1000; // 15 minutes
  
  // Refresh if expiring within (CHECK_INTERVAL + buffer)
  // Buffer: 5 minutes for safety
  const REFRESH_THRESHOLD = Math.floor(CHECK_INTERVAL / 60000) + 5; // 20 minutes
  
  async function checkAndRefreshTokens() {
    for (const [agentName, config] of Object.entries(AGENTS)) {
      try {
        // Read current token via TokenManager (supports both SQLite and file-based)
        const tokens = tokenManager.getTokens(agentName, config.tokenFile);
        const expiresAt = tokens.obtained_at + (tokens.expires_in * 1000);
        const minutesUntilExpiry = Math.floor((expiresAt - Date.now()) / 60000);
        
        // Log token status
        if (minutesUntilExpiry > 0) {
          console.log(`[${agentName}] Token valid for ${minutesUntilExpiry} minutes`);
        } else {
          console.log(`[${agentName}] ⚠️ Token expired ${Math.abs(minutesUntilExpiry)} minutes ago!`);
        }
        
        // Proactively refresh if expiring within threshold
        // This ensures token won't expire before next check
        if (minutesUntilExpiry < REFRESH_THRESHOLD) {
          console.log(`[${agentName}] Proactive token refresh (${minutesUntilExpiry} min remaining, threshold: ${REFRESH_THRESHOLD} min)...`);
          await getAccessToken(agentName); // This will trigger refresh
          
          // Re-read token to get new expiry via TokenManager
          const newTokens = tokenManager.getTokens(agentName, config.tokenFile);
          const newExpiresAt = newTokens.obtained_at + (newTokens.expires_in * 1000);
          const newMinutes = Math.floor((newExpiresAt - Date.now()) / 60000);
          
          console.log(`[${agentName}] ✓ Token refreshed proactively (now valid for ${newMinutes} minutes)`);
        }
      } catch (error) {
        console.error(`[${agentName}] Token refresh check error:`, error.message);
      }
    }
  }
  
  // Run immediately on startup
  setTimeout(checkAndRefreshTokens, 10000); // 10 seconds after startup
  
  // Then every 15 minutes
  setInterval(checkAndRefreshTokens, CHECK_INTERVAL);
  
  console.log(`Token refresh timer started (checks every ${CHECK_INTERVAL / 60000} minutes, refreshes if < ${REFRESH_THRESHOLD} min remaining)`);
}

// Initialize user IDs then start services
initializeAgentUserIds().then(() => {
  // Start subscription auto-renewal for all agents
  for (const [agentName, manager] of Object.entries(subscriptionManagers)) {
    manager.startAutoRenewal();
  }
  
  // Start proactive token refresh timer
  startTokenRefreshTimer();
});

// ==================== START SERVER ====================

app.listen(PORT, () => {
  console.log(`✅ Microsoft 365 Integration Server running on port ${PORT}`);
  console.log(`   Agents: ${Object.keys(AGENTS).join(', ')}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Subscription managers: ${Object.keys(subscriptionManagers).join(', ')}`);
  console.log(`   Subscription auto-renewal: Every 5 minutes`);
  console.log(`   Token refresh checks: Every 15 minutes (proactive)`);
  
  // Set all agents to Available on startup
  setTimeout(initializePresence, 5000);
  
  // Refresh presence every 3 hours (expires after 4 hours)
  setInterval(() => initializePresence(), 3 * 60 * 60 * 1000);
});

// ==================== WEBHOOKS ONLY ====================
// All Teams messages are received via webhooks at /webhook/teams/:agent
// No polling needed - Microsoft Graph sends real-time notifications


// Add attachment to calendar event
app.post('/api/calendar/event/:agent/:eventId/attachment', async (req, res) => {
  const { agent, eventId } = req.params;
  const { filePath, fileName, contentType } = req.body;
  
  // Validate required fields
  if (!agent || !eventId || !filePath) {
    return res.status(400).json(ErrorTypes.VALIDATION_MISSING_FIELDS(['agent', 'eventId', 'filePath']));
  }
  
  // Validate agent exists
  if (!AGENTS[agent]) {
    return res.status(404).json(ErrorTypes.VALIDATION_INVALID_AGENT(agent, Object.keys(AGENTS)));
  }
  
  try {
    const token = await getAccessToken(agent);
    const fs = require('fs');
    
    // Check file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json(ErrorTypes.FILE_NOT_FOUND(filePath));
    }
    
    // Read file and check size (3MB limit for Graph API)
    const fileStats = fs.statSync(filePath);
    const maxSize = 3 * 1024 * 1024; // 3MB
    
    if (fileStats.size > maxSize) {
      return res.status(413).json(ErrorTypes.FILE_TOO_LARGE(fileStats.size, 3));
    }
    
    // Read file and convert to base64
    const fileContent = fs.readFileSync(filePath);
    const base64Content = fileContent.toString('base64');
    
    const attachment = {
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: fileName || require('path').basename(filePath),
      contentType: contentType || 'application/octet-stream',
      contentBytes: base64Content
    };
    
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/events/${eventId}/attachments`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(attachment)
      }
    );
    
    if (response.ok) {
      const data = await response.json();
      const fileSizeKB = (fileStats.size / 1024).toFixed(2);
      console.log(`[${agent}] Added attachment to event ${eventId}: ${fileName || require('path').basename(filePath)} (${fileSizeKB} KB)`);
      res.json({ 
        success: true, 
        attachment: {
          id: data.id,
          name: data.name,
          size: fileStats.size,
          contentType: data.contentType
        }
      });
    } else {
      // Parse Graph API error
      const graphError = await parseGraphError(response, 'calendar event');
      return res.status(response.status).json(graphError);
    }
  } catch (error) {
    console.error(`[${agent}] Calendar attachment error:`, error.message);
    
    // File operation errors already handled above
    // This catches other errors (network, auth, etc.)
    if (error.message.includes('token') || error.message.includes('auth')) {
      return res.status(401).json(ErrorTypes.AUTH_TOKEN_EXPIRED(agent));
    }
    
    res.status(500).json(ErrorTypes.SERVER_ERROR(`Failed to attach file: ${error.message}`, error));
  }
});

// List calendar event attachments
app.get('/api/calendar/event/:agent/:eventId/attachments', async (req, res) => {
  const { agent, eventId } = req.params;
  
  try {
    const token = await getAccessToken(agent);
    
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/events/${eventId}/attachments`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    if (response.ok) {
      const data = await response.json();
      res.json(data.value || []);
    } else {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `Failed: ${response.status}`);
    }
  } catch (error) {
    console.error(`[${agent}] Calendar attachments list error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});
