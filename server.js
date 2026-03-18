#!/usr/bin/env node
/**
 * Microsoft 365 Integration Server
 * Centralized Teams, Email, and Calendar management for all OpenClaw agents
 * Port: 3007
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
require('dotenv').config(); // Load .env file
const SubscriptionManager = require('./subscription-manager');
const { handleCalendarNotification } = require('./webhooks/calendar-handler');

const app = express();
const PORT = process.env.PORT || 3007;

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
  const tenantId = process.env[`${prefix}_TENANT_ID`];
  const tokenFile = process.env[`${prefix}_TOKEN_FILE`];
  const gatewayUrl = process.env[`${prefix}_GATEWAY_URL`];
  const gatewayToken = process.env[`${prefix}_GATEWAY_TOKEN`];
  const displayName = process.env[`${prefix}_DISPLAY_NAME`];
  const agentId = process.env[`${prefix}_AGENT_ID`] || agentName;
  
  // Only create agent config if required fields exist
  if (clientId && tenantId && tokenFile && gatewayUrl && gatewayToken && displayName) {
    return {
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

async function getAccessToken(agent) {
  const config = AGENTS[agent];
  if (!config) throw new Error(`Unknown agent: ${agent}`);
  
  const tokens = JSON.parse(fs.readFileSync(config.tokenFile, 'utf8'));
  const expiresAt = tokens.obtained_at + (tokens.expires_in * 1000);
  
  // Refresh if expired or expiring soon (5 min buffer)
  if (Date.now() > expiresAt - 300000) {
    console.log(`[${agent}] Refreshing access token...`);
    const response = await fetch(
      `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId,
          refresh_token: tokens.refresh_token,
          grant_type: 'refresh_token',
          scope: 'https://graph.microsoft.com/.default'
        })
      }
    );
    
    const newTokens = await response.json();
    if (newTokens.error) {
      throw new Error(`Token refresh failed: ${newTokens.error_description}`);
    }
    
    newTokens.obtained_at = Date.now();
    fs.writeFileSync(config.tokenFile, JSON.stringify(newTokens, null, 2));
    return newTokens.access_token;
  }
  
  return tokens.access_token;
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
        
        // FILTER 1: Skip own messages (check actual Teams display name)
        const fromDisplayName = message.from?.user?.displayName;
        if (fromDisplayName === config.displayName) {
          console.log(`[${agent}] Skipping own message from ${fromDisplayName}`);
          continue;
        }
        
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
        const chatType = isGroupChat ? 'GROUP' : '1:1';
        
        console.log(`[${agent}] [${chatType}] Teams message from ${from}: ${content.substring(0, 50)}...`);
        
        // Format message text with agent-specific reply command
        const replyScript = agent === 'sophia' 
          ? 'node sophia-teams-reply.js' 
          : agent === 'kim'
          ? 'node kim-teams-reply.js'
          : 'node ~/clawd/max-teams-reply.js';
        
        const wakeText = `💬 Teams message from ${from}: "${content}"\n\nChat ID: ${chatId}\n\nPlease respond to this Teams message using:\n${replyScript} "${chatId}" "<your reply in HTML format>"`;
        
        // Create persistent session key based on chatId
        // This maintains conversation context across messages
        const persistentSessionKey = `hook:teams:${chatId}`;
        
        // Forward to agent gateway
        const payload = config.agentId ? {
          // Max uses /hooks/agent format with persistent session
          message: wakeText,
          name: 'Teams',
          agentId: config.agentId,
          sessionKey: persistentSessionKey,
          deliver: true
        } : {
          // Other agents use /hooks/wake format
          text: wakeText
        };
        
        console.log(`[${agent}] Forwarding to ${config.gatewayUrl}...`);
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
  const { agent, chatId, message } = req.body;
  
  if (!agent || !chatId || !message) {
    return res.status(400).json({ error: 'Missing required fields: agent, chatId, message' });
  }
  
  try {
    const token = await getAccessToken(agent);
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/chats/${chatId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          body: {
            contentType: 'html',
            content: message
          }
        })
      }
    );
    
    if (response.status === 201) {
      console.log(`[${agent}] Sent Teams message to ${chatId}`);
      
      // Update presence to Available after sending message
      try {
        await fetch('https://graph.microsoft.com/v1.0/me/presence/setPresence', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            sessionId: `openclaw-${agent}-${Date.now()}`,
            availability: 'Available',
            activity: 'Available'
          })
        });
        console.log(`[${agent}] Updated presence to Available`);
      } catch (presenceError) {
        console.warn(`[${agent}] Could not update presence:`, presenceError.message);
      }
      
      res.json({ success: true });
    } else {
      const error = await response.text();
      throw new Error(`Failed to send: ${error}`);
    }
  } catch (error) {
    console.error(`[${agent}] Teams send error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// ==================== EMAIL ====================

// List emails
app.get('/api/email/list/:agent', async (req, res) => {
  const { agent } = req.params;
  const limit = parseInt(req.query.limit) || 10;
  
  try {
    const token = await getAccessToken(agent);
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages?$top=${limit}&$select=id,subject,from,receivedDateTime,bodyPreview,isRead`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    
    const data = await response.json();
    res.json(data.value || []);
  } catch (error) {
    console.error(`[${agent}] Email list error:`, error.message);
    res.status(500).json({ error: error.message });
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

// ==================== CALENDAR ====================

// List calendar events
app.get('/api/calendar/list/:agent', async (req, res) => {
  const { agent } = req.params;
  const days = parseInt(req.query.days) || 7;
  
  try {
    const token = await getAccessToken(agent);
    const startDate = new Date().toISOString();
    const endDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${startDate}&endDateTime=${endDate}&$select=subject,start,end,location&$orderby=start/dateTime`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    
    const data = await response.json();
    res.json(data.value || []);
  } catch (error) {
    console.error(`[${agent}] Calendar list error:`, error.message);
    res.status(500).json({ error: error.message });
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
        sessionKey: `hook:email:${resourceId.substring(0, 20)}`,
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

// ==================== HEALTH & STATUS ====================

app.get('/health', (req, res) => {
  res.json({ status: 'ok', agents: Object.keys(AGENTS) });
});

app.get('/status/:agent', async (req, res) => {
  const { agent } = req.params;
  
  try {
    const token = await getAccessToken(agent);
    res.json({ agent, tokenValid: !!token });
  } catch (error) {
    res.status(500).json({ agent, error: error.message });
  }
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
      } else {
        console.warn(`[${agentName}] Could not fetch user ID`);
      }
    } catch (error) {
      console.error(`[${agentName}] Error fetching user ID:`, error.message);
    }
  }
}

// Initialize user IDs then start auto-renewal
initializeAgentUserIds().then(() => {
  // Start auto-renewal for all agents
  for (const [agentName, manager] of Object.entries(subscriptionManagers)) {
    manager.startAutoRenewal();
  }
});

// ==================== START SERVER ====================

app.listen(PORT, () => {
  console.log(`✅ Microsoft 365 Integration Server running on port ${PORT}`);
  console.log(`   Agents: ${Object.keys(AGENTS).join(', ')}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Subscription managers: ${Object.keys(subscriptionManagers).join(', ')}`);
  console.log(`   Auto-renewal: Every 5 minutes for all subscriptions`);
});

// ==================== WEBHOOKS ONLY ====================
// All Teams messages are received via webhooks at /webhook/teams/:agent
// No polling needed - Microsoft Graph sends real-time notifications

