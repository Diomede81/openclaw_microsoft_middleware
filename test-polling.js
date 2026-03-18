const fs = require('fs');

const AGENTS = {
  max: {
    name: 'Max',
    clientId: '79b3f60a-ddfe-4029-8af4-1c95a37c6aa7',
    tenantId: '982780f8-0424-4e57-9cc0-bee3d6acc797',
    tokenFile: '/home/lucalicata/clawd/max-microsoft-tokens.json',
    gatewayUrl: 'http://localhost:18789/hooks/agent',
    gatewayToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJlNmQ0NzMxNjk0Y2U0MmFmYjkwZWJlNzMzYmU3Nzc1ZSIsImlhdCI6MTc2OTY4NzMxNSwiZXhwIjoyMDg1MDQ3MzE1fQ.Yzz_QkIBbZfdTOEa_qvI_0gCUPfKLFPjYXWjAe_VYVk',
    agentId: 'max'
  }
};

async function getAccessToken(agent) {
  const config = AGENTS[agent];
  const tokens = JSON.parse(fs.readFileSync(config.tokenFile, 'utf8'));
  return tokens.access_token;
}

const teamsLastCheck = {};

async function pollTeamsMessages() {
  console.log('[DEBUG] Starting polling...');
  
  for (const agent of Object.keys(AGENTS)) {
    try {
      console.log(`[DEBUG] Processing agent: ${agent}`);
      const config = AGENTS[agent];
      const token = await getAccessToken(agent);
      console.log(`[DEBUG] Got token for ${agent}`);
      
      // Get all chats
      const chatsResp = await fetch(
        'https://graph.microsoft.com/v1.0/me/chats',
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const chatsData = await chatsResp.json();
      console.log(`[DEBUG] Got ${chatsData.value?.length || 0} chats`);
      
      if (chatsData.error) {
        console.error(`[${agent}] Error fetching chats:`, chatsData.error.message);
        continue;
      }
      
      for (const chat of chatsData.value || []) {
        const chatId = chat.id;
        
        if (!teamsLastCheck[agent]) teamsLastCheck[agent] = {};
        const lastCheckTime = teamsLastCheck[agent][chatId] || new Date(Date.now() - 10 * 60 * 1000).toISOString();
        
        console.log(`[DEBUG] Checking chat ${chatId.substring(0, 20)}... since ${lastCheckTime}`);
        
        const messagesResp = await fetch(
          `https://graph.microsoft.com/v1.0/me/chats/${chatId}/messages?$filter=createdDateTime gt ${lastCheckTime}`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        const messagesData = await messagesResp.json();
        
        if (messagesData.error) {
          console.error(`[DEBUG] Error fetching messages:`, messagesData.error.message);
          continue;
        }
        
        console.log(`[DEBUG] Found ${messagesData.value?.length || 0} new messages in this chat`);
        
        for (const message of messagesData.value || []) {
          const from = message.from?.user?.displayName || 'Unknown';
          
          if (from.includes('Max') || from.includes('Ferretti')) {
            console.log(`[DEBUG] Skipping own message from ${from}`);
            continue;
          }
          
          const content = message.body?.content?.replace(/<[^>]*>/g, '').trim() || '';
          
          if (!content) {
            console.log(`[DEBUG] Skipping empty message`);
            continue;
          }
          
          console.log(`[${agent}] NEW MESSAGE from ${from}: ${content.substring(0, 50)}...`);
          
          const persistentSessionKey = `teams:chat:${chatId}`;
          const replyScript = 'node ~/clawd/max-teams-reply.js';
          const wakeText = `💬 Teams message from ${from}: "${content}"\n\nChat ID: ${chatId}\n\nPlease respond using:\n${replyScript} "${chatId}" "<your reply>"`;
          
          const payload = {
            message: wakeText,
            name: 'Teams',
            agentId: config.agentId,
            sessionKey: persistentSessionKey,
            deliver: true
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
          const result = await fwdResp.text();
          console.log(`[${agent}] Gateway response: ${result}`);
          
          teamsLastCheck[agent][chatId] = message.createdDateTime;
        }
      }
    } catch (error) {
      console.error(`[${agent}] Polling error:`, error.message);
      console.error(error.stack);
    }
  }
  
  console.log('[DEBUG] Polling complete');
}

pollTeamsMessages();
