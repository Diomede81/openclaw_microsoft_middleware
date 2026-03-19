/**
 * Calendar webhook handler
 * Processes calendar event notifications from Microsoft Graph
 */

async function handleCalendarNotification(agent, notification, getAccessToken, agentConfig) {
  const resourceId = notification.resourceData?.id;
  const changeType = notification.changeType;
  
  if (!resourceId) {
    console.log(`[${agent}] Calendar notification missing resourceId`);
    return;
  }
  
  try {
    const token = await getAccessToken(agent);
    
    // Fetch event details
    const eventResp = await fetch(
      `https://graph.microsoft.com/v1.0/me/events/${resourceId}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    
    // Handle deleted events (404)
    if (eventResp.status === 404) {
      console.log(`[${agent}] Calendar event deleted: ${resourceId}`);
      
      const wakeText = `📅 Calendar event deleted\n\nEvent ID: ${resourceId}`;
      
      await forwardToAgent(agent, agentConfig, wakeText, `hook:calendar:${resourceId.substring(0, 20)}`);
      return;
    }
    
    const event = await eventResp.json();
    
    if (event.error) {
      console.error(`[${agent}] Error fetching calendar event:`, event.error.message);
      return;
    }
    
    const subject = event.subject || '(no subject)';
    const start = event.start ? new Date(event.start.dateTime).toLocaleString('en-GB', { timeZone: event.start.timeZone || 'Europe/London' }) : 'Unknown';
    const end = event.end ? new Date(event.end.dateTime).toLocaleString('en-GB', { timeZone: event.end.timeZone || 'Europe/London' }) : 'Unknown';
    const location = event.location?.displayName || 'No location';
    const attendees = event.attendees?.map(a => a.emailAddress.name || a.emailAddress.address).join(', ') || 'None';
    
    console.log(`[${agent}] Calendar event ${changeType}: ${subject}`);
    
    // Format notification based on change type
    let emoji = '📅';
    let action = '';
    
    switch (changeType) {
      case 'created':
        emoji = '🆕';
        action = 'New calendar event';
        break;
      case 'updated':
        emoji = '📝';
        action = 'Calendar event updated';
        break;
      case 'deleted':
        emoji = '🗑️';
        action = 'Calendar event deleted';
        break;
      default:
        action = 'Calendar event changed';
    }
    
    const wakeText = `${emoji} ${action}\n\n**Subject:** ${subject}\n**Start:** ${start}\n**End:** ${end}\n**Location:** ${location}\n**Attendees:** ${attendees}\n\n---\nEvent ID: ${resourceId}`;
    
    // Forward to agent gateway
    await forwardToAgent(agent, agentConfig, wakeText, `hook:calendar:${resourceId.substring(0, 20)}`);
    
  } catch (error) {
    console.error(`[${agent}] Calendar webhook error:`, error.message);
  }
}

async function forwardToAgent(agent, agentConfig, wakeText, sessionKey) {
  const payload = agentConfig.agentId ? {
    message: wakeText,
    name: 'Calendar',
    agentId: agentConfig.agentId,
    sessionKey: sessionKey,
    deliver: true
  } : {
    text: wakeText
  };
  
  console.log(`[${agent}] Forwarding calendar notification to ${agentConfig.gatewayUrl}...`);
  const fwdResp = await fetch(agentConfig.gatewayUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${agentConfig.gatewayToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const fwdResult = await fwdResp.text();
  console.log(`[${agent}] Gateway response: ${fwdResult.substring(0, 100)}`);
}

module.exports = { handleCalendarNotification };
