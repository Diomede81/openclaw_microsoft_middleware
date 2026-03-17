const fs = require('fs');

const AGENTS = {
  max: {
    tokensFile: '/home/lucalicata/clawd/max-microsoft-tokens.json',
    gatewayUrl: 'http://localhost:18789/hooks/agent',
    gatewayToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJlNmQ0NzMxNjk0Y2U0MmFmYjkwZWJlNzMzYmU3Nzc1ZSIsImlhdCI6MTc2OTY4NzMxNSwiZXhwIjoyMDg1MDQ3MzE1fQ.Yzz_QkIBbZfdTOEa_qvI_0gCUPfKLFPjYXWjAe_VYVk',
    agentId: 'max',
    clientId: '79b3f60a-ddfe-4029-8af4-1c95a37c6aa7',
    tenantId: '982780f8-0424-4e57-9cc0-bee3d6acc797'
  }
};

const LAST_CHECK_FILE = './last-teams-check.json';

async function getAccessToken(agent) {
  const config = AGENTS[agent];
  const tokens = JSON.parse(fs.readFileSync(config.tokensFile, 'utf8'));
  const expiresAt = tokens.obtained_at + (tokens.expires_in * 1000);
  
  if (Date.now() > expiresAt - 300000) {
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
    if (newTokens.error) throw new Error(newTokens.error_description);
    newTokens.obtained_at = Date.now();
    fs.writeFileSync(config.tokensFile, JSON.stringify(newTokens, null, 2));
    return newTokens.access_token;
  }
  return tokens.access_token;
}

async function pollTeamsMessages() {
  console.log(`[${new Date().toISOString()}] Checking Teams messages...`);
  
  for (const agent of Object.keys(AGENTS)) {
    try {
      let lastCheck = { [agent]: {} };
      if (fs.existsSync(LAST_CHECK_FILE)) {
        lastCheck = JSON.parse(fs.readFileSync(LAST_CHECK_FILE, 'utf8'));
      }
      
      const config = AGENTS[agent];
      const token = await getAccessToken(agent);
      
      // Get all chats
      const chatsResp = await fetch(
        'https://graph.microsoft.com/v1.0/me/chats?$expand=lastMessagePreview',
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const chatsData = await chatsResp.json();
      
      for (const chat of chatsData.value || []) {
        const chatId = chat.id;
        const lastMessageTime = lastCheck[agent]?.[chatId] || new Date(Date.now() - 2 * 60 * 1000).toISOString();
        
        // Get messages after last check
        const messagesResp = await fetch(
          `https://graph.microsoft.com/v1.0/me/chats/${chatId}/messages?$filter=createdDateTime gt ${lastMessageTime}&$orderby=createdDateTime`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        const messagesData = await messagesResp.json();
        
        for (const message of messagesData.value || []) {
          // Skip own messages
          if (message.from?.user?.displayName?.includes('Max') || 
              message.from?.user?.displayName?.includes('Ferretti')) {
            continue;
          }
          
          const content = message.body?.content?.replace(/<[^>]*>/g, '').trim() || '';
          const from = message.from?.user?.displayName || 'Unknown';
          
          if (!content) continue;
          
          console.log(`[${agent}] Teams message from ${from}: ${content.substring(0, 50)}...`);
          
          const replyScript = 'node ~/clawd/max-teams-reply.js';
          const wakeText = `💬 Teams message from ${from}: "${content}"\n\nChat ID: ${chatId}\n\nPlease respond using:\n${replyScript} "${chatId}" "<your reply>"`;
          const persistentSessionKey = `teams:chat:${chatId}`;
          
          const payload = {
            message: wakeText,
            name: 'Teams',
            agentId: config.agentId,
            sessionKey: persistentSessionKey,
            deliver: true
          };
          
          console.log(`[${agent}] Forwarding to gateway...`);
          const fwdResp = await fetch(config.gatewayUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${config.gatewayToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          });
          const result = await fwdResp.text();
          console.log(`[${agent}] Gateway response: ${result.substring(0, 100)}`);
          
          // Update last check time for this chat
          if (!lastCheck[agent]) lastCheck[agent] = {};
          lastCheck[agent][chatId] = message.createdDateTime;
        }
      }
      
      // Save last check times
      fs.writeFileSync(LAST_CHECK_FILE, JSON.stringify(lastCheck, null, 2));
      console.log(`[${agent}] Polling complete`);
      
    } catch (error) {
      console.error(`[${agent}] Polling error:`, error.message);
    }
  }
}

pollTeamsMessages();
