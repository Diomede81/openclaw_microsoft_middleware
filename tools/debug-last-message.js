#!/usr/bin/env node
/**
 * Debug the last message to see mention structure
 */

const fs = require('fs');

const CONFIG = {
  clientId: '79b3f60a-ddfe-4029-8af4-1c95a37c6aa7',
  tenantId: '982780f8-0424-4e57-9cc0-bee3d6acc797',
  tokenFile: '/home/lucalicata/clawd/max-microsoft-tokens.json'
};

async function getAccessToken() {
  const tokens = JSON.parse(fs.readFileSync(CONFIG.tokenFile, 'utf8'));
  const expiresAt = tokens.obtained_at + (tokens.expires_in * 1000);
  
  if (Date.now() > expiresAt - 300000) {
    const response = await fetch(
      `https://login.microsoftonline.com/${CONFIG.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CONFIG.clientId,
          refresh_token: tokens.refresh_token,
          grant_type: 'refresh_token',
          scope: 'https://graph.microsoft.com/.default'
        })
      }
    );
    
    const newTokens = await response.json();
    newTokens.obtained_at = Date.now();
    fs.writeFileSync(CONFIG.tokenFile, JSON.stringify(newTokens, null, 2));
    return newTokens.access_token;
  }
  
  return tokens.access_token;
}

async function debugMessage() {
  const token = await getAccessToken();
  
  // Get recent chats
  const chatsResp = await fetch(
    'https://graph.microsoft.com/v1.0/me/chats?$top=10&$select=id,topic,chatType',
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  const chats = await chatsResp.json();
  
  console.log('\n=== Recent Chats ===');
  for (const chat of chats.value || []) {
    console.log(`${chat.chatType === 'group' ? '👥' : '💬'} ${chat.topic || 'Unnamed'} (${chat.id})`);
    
    if (chat.topic === 'NHS Assessments CAREAPPS') {
      console.log('\n=== NHS Assessments CAREAPPS - Last Messages ===\n');
      
      const messagesResp = await fetch(
        `https://graph.microsoft.com/v1.0/me/chats/${chat.id}/messages?$top=5&$orderby=createdDateTime desc`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const messages = await messagesResp.json();
      
      for (const msg of messages.value || []) {
        console.log('---');
        console.log('ID:', msg.id);
        console.log('From:', msg.from?.user?.displayName || 'Unknown');
        console.log('Time:', msg.createdDateTime);
        console.log('Content:', msg.body?.content?.replace(/<[^>]*>/g, '').substring(0, 100));
        console.log('Mentions:', JSON.stringify(msg.mentions, null, 2));
        console.log('');
      }
    }
  }
}

debugMessage().catch(console.error);
