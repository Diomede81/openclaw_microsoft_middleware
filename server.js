#!/usr/bin/env node
/**
 * Microsoft 365 Integration Server
 * Centralized Teams, Email, and Calendar management for all OpenClaw agents
 * Port: 3007
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3007;

// Agent configurations
const AGENTS = {
  max: {
    name: 'Max',
    clientId: '79b3f60a-ddfe-4029-8af4-1c95a37c6aa7',
    tenantId: '982780f8-0424-4e57-9cc0-bee3d6acc797',
    tokenFile: '/home/lucalicata/clawd/max-microsoft-tokens.json',
    gatewayUrl: 'http://localhost:18789/hooks/agent',
    gatewayToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJlNmQ0NzMxNjk0Y2U0MmFmYjkwZWJlNzMzYmU3Nzc1ZSIsImlhdCI6MTc2OTY4NzMxNSwiZXhwIjoyMDg1MDQ3MzE1fQ.Yzz_QkIBbZfdTOEa_qvI_0gCUPfKLFPjYXWjAe_VYVk',
    agentId: 'max'
  },
  sophia: {
    name: 'Sophia',
    clientId: '50d301c0-ad4f-458b-95ec-f3c966f60f6c',
    tenantId: 'f2b38637-cb43-45b5-a5e8-e7a09fe436bb',
    tokenFile: '/home/lucalicata/clawd/sophia-microsoft-tokens.json',
    gatewayUrl: 'http://localhost:19789/hooks/agent',
    gatewayToken: 'sophia-hooks-token-2026',
    agentId: 'sophia'
  },
  // Kim now runs on her own laptop server (192.168.1.145:3007)
  // https://kim.acuity.expert
};

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
        
        // Skip own messages
        if (message.from?.user?.displayName === config.name) continue;
        
        const content = message.body?.content?.replace(/<[^>]*>/g, '').trim() || '';
        const from = message.from?.user?.displayName || 'Unknown';
        
        console.log(`[${agent}] Teams message from ${from}: ${content.substring(0, 50)}...`);
        
        // Format message text with agent-specific reply command
        const replyScript = agent === 'sophia' 
          ? 'node sophia-teams-reply.js' 
          : agent === 'kim'
          ? 'node kim-teams-reply.js'
          : 'node ~/clawd/max-teams-reply.js';
        
        const wakeText = `💬 Teams message from ${from}: "${content}"\n\nChat ID: ${chatId}\n\nPlease respond to this Teams message using:\n${replyScript} "${chatId}" "<your reply in HTML format>"`;
        
        // Create persistent session key based on chatId
        // This maintains conversation context across messages
        const persistentSessionKey = `teams:chat:${chatId}`;
        
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

// Create Teams subscription
app.post('/api/subscription/teams/:agent', async (req, res) => {
  const { agent } = req.params;
  const config = AGENTS[agent];
  
  if (!config) {
    return res.status(404).json({ error: 'Unknown agent' });
  }
  
  try {
    const token = await getAccessToken(agent);
    const expirationDateTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const webhookUrl = `https://microsoft.acuity.expert/webhook/teams/${agent}`;
    
    const response = await fetch(
      'https://graph.microsoft.com/v1.0/subscriptions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          changeType: 'created',
          notificationUrl: webhookUrl,
          resource: '/me/chats/getAllMessages',
          expirationDateTime,
          clientState: `${agent}-teams`
        })
      }
    );
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message);
    }
    
    console.log(`[${agent}] Teams subscription created: ${data.id}`);
    res.json({ success: true, subscriptionId: data.id, expiresAt: data.expirationDateTime });
  } catch (error) {
    console.error(`[${agent}] Subscription error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Create Email subscription
app.post('/api/subscription/email/:agent', async (req, res) => {
  const { agent } = req.params;
  const config = AGENTS[agent];
  
  if (!config) {
    return res.status(404).json({ error: 'Unknown agent' });
  }
  
  try {
    const token = await getAccessToken(agent);
    const expirationDateTime = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(); // 3 days max
    const webhookUrl = `https://microsoft.acuity.expert/webhook/email/${agent}`;
    
    const response = await fetch(
      'https://graph.microsoft.com/v1.0/subscriptions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          changeType: 'created',
          notificationUrl: webhookUrl,
          resource: '/me/messages',
          expirationDateTime,
          clientState: `${agent}-email`
        })
      }
    );
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message);
    }
    
    console.log(`[${agent}] Email subscription created: ${data.id}`);
    res.json({ success: true, subscriptionId: data.id, expiresAt: data.expirationDateTime });
  } catch (error) {
    console.error(`[${agent}] Email subscription error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// List active subscriptions
app.get('/api/subscription/list/:agent', async (req, res) => {
  const { agent } = req.params;
  
  try {
    const token = await getAccessToken(agent);
    const response = await fetch(
      'https://graph.microsoft.com/v1.0/subscriptions',
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    
    const data = await response.json();
    res.json(data.value || []);
  } catch (error) {
    console.error(`[${agent}] List subscriptions error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Renew subscription
app.post('/api/subscription/renew/:agent/:subscriptionId', async (req, res) => {
  const { agent, subscriptionId } = req.params;
  
  try {
    const token = await getAccessToken(agent);
    const expirationDateTime = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour for Teams
    
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ expirationDateTime })
      }
    );
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message);
    }
    
    console.log(`[${agent}] Subscription renewed: ${subscriptionId}`);
    res.json({ success: true, expiresAt: data.expirationDateTime });
  } catch (error) {
    console.error(`[${agent}] Renew subscription error:`, error.message);
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

// ==================== AUTO-RENEWAL ====================

// Store subscription IDs for auto-renewal
const subscriptions = {
  // Format: agent: { teams: subscriptionId, email: subscriptionId }
};

// Auto-renew Teams subscriptions every 45 minutes (before 60min expiry)
async function autoRenewTeamsSubscriptions() {
  console.log('[auto-renew] Checking Teams subscriptions...');
  
  for (const agent of Object.keys(AGENTS)) {
    try {
      const token = await getAccessToken(agent);
      
      // List current subscriptions
      const listResp = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await listResp.json();
      
      // Find Teams subscription for this agent
      const teamsSub = data.value?.find(s => 
        s.resource === '/me/chats/getAllMessages' && 
        s.clientState === `${agent}-teams`
      );
      
      if (teamsSub) {
        // Renew if expires within 20 minutes
        const expiresAt = new Date(teamsSub.expirationDateTime);
        const minutesUntilExpiry = (expiresAt - Date.now()) / 60000;
        
        if (minutesUntilExpiry < 20) {
          console.log(`[${agent}] Teams subscription expires in ${minutesUntilExpiry.toFixed(1)}min, renewing...`);
          
          const newExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
          const renewResp = await fetch(
            `https://graph.microsoft.com/v1.0/subscriptions/${teamsSub.id}`,
            {
              method: 'PATCH',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ expirationDateTime: newExpiry })
            }
          );
          
          if (renewResp.ok) {
            console.log(`[${agent}] Teams subscription renewed: ${teamsSub.id}`);
            subscriptions[agent] = { ...subscriptions[agent], teams: teamsSub.id };
          } else {
            console.error(`[${agent}] Failed to renew Teams subscription:`, await renewResp.text());
          }
        } else {
          console.log(`[${agent}] Teams subscription OK (${minutesUntilExpiry.toFixed(1)}min remaining)`);
        }
      } else {
        console.log(`[${agent}] No Teams subscription found, creating...`);
        
        // Create new subscription
        const webhookUrl = `https://microsoft.acuity.expert/webhook/teams/${agent}`;
        const expirationDateTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        
        const createResp = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            changeType: 'created',
            notificationUrl: webhookUrl,
            resource: '/me/chats/getAllMessages',
            expirationDateTime,
            clientState: `${agent}-teams`
          })
        });
        
        if (createResp.ok) {
          const newSub = await createResp.json();
          console.log(`[${agent}] Teams subscription created: ${newSub.id}`);
          subscriptions[agent] = { ...subscriptions[agent], teams: newSub.id };
        } else {
          console.error(`[${agent}] Failed to create Teams subscription:`, await createResp.text());
        }
      }
    } catch (error) {
      console.error(`[${agent}] Auto-renewal error:`, error.message);
    }
  }
}

// Run auto-renewal every 45 minutes
setInterval(autoRenewTeamsSubscriptions, 45 * 60 * 1000);

// Run immediately on startup
setTimeout(autoRenewTeamsSubscriptions, 5000);

// ==================== START SERVER ====================

app.listen(PORT, () => {
  console.log(`✅ Microsoft 365 Integration Server running on port ${PORT}`);
  console.log(`   Agents: ${Object.keys(AGENTS).join(', ')}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Auto-renewal: Teams subscriptions every 45 minutes`);
});
