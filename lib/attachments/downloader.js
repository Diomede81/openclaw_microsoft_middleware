/**
 * Teams Attachment Downloader
 * Downloads file attachments from Teams messages via Graph API
 * 
 * Teams attachments are hosted on SharePoint/OneDrive and require
 * authenticated access via Microsoft Graph to download.
 */

const fs = require('fs');
const path = require('path');

class AttachmentDownloader {
  constructor(config) {
    this.tokenManager = config.tokenManager;
    this.downloadDir = config.downloadDir || '/tmp/teams-attachments';
    
    // Ensure download directory exists
    if (!fs.existsSync(this.downloadDir)) {
      fs.mkdirSync(this.downloadDir, { recursive: true });
    }
  }

  /**
   * Get access token for an agent
   */
  async getAccessToken(agentName, tokenFile, tenantId, clientId) {
    const tokens = this.tokenManager.getTokens(agentName, tokenFile);
    const expiresAt = tokens.obtained_at + (tokens.expires_in * 1000);
    
    // Refresh if expired or expiring soon
    if (Date.now() > expiresAt - 300000) {
      const response = await fetch(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
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
      this.tokenManager.setTokens(agentName, newTokens, tokenFile);
      return newTokens.access_token;
    }
    
    return tokens.access_token;
  }

  /**
   * Download a single attachment from Teams
   * 
   * @param {Object} attachment - Attachment object from Teams webhook
   * @param {Object} agentConfig - Agent configuration (name, tokenFile, tenantId, clientId)
   * @returns {Object} Downloaded file info { path, name, contentType, size }
   */
  async downloadAttachment(attachment, agentConfig) {
    const { name, contentType, contentUrl, id } = attachment;
    const { agentName, tokenFile, tenantId, clientId } = agentConfig;

    console.log(`[${agentName}] Downloading attachment: ${name}`);

    try {
      const accessToken = await this.getAccessToken(agentName, tokenFile, tenantId, clientId);

      // Teams attachments can be in different formats:
      // 1. reference - file hosted in SharePoint/OneDrive (contentUrl is a sharepoint link)
      // 2. file - inline file with content
      
      let downloadUrl = contentUrl;
      
      // If it's a SharePoint/OneDrive reference, we need to get the download URL
      if (contentUrl && (contentUrl.includes('sharepoint.com') || contentUrl.includes('onedrive'))) {
        // Extract the drive item path from the URL and use Graph API
        // The contentUrl format varies, so we'll try to use the attachment ID if available
        
        // Try using the hosted content endpoint for chat attachments
        if (attachment.contentType === 'reference') {
          // For references, we need to resolve the actual file
          // This typically requires getting the file from the chat's files tab
          console.log(`[${agentName}] Attachment is a reference type - attempting Graph download`);
        }
      }

      // For hosted content (inline attachments), use the Graph API endpoint
      // Format: /chats/{chat-id}/messages/{message-id}/hostedContents/{hosted-content-id}
      // But we may not have all IDs, so try direct download first
      
      const response = await fetch(downloadUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': '*/*'
        }
      });

      if (!response.ok) {
        // If direct download fails, the URL might be a sharing link
        // Try to resolve it via Graph API
        console.log(`[${agentName}] Direct download failed (${response.status}), trying Graph API...`);
        
        // For SharePoint files shared in Teams, we can try the driveItem endpoint
        // But we need to parse the sharing URL - this is complex
        throw new Error(`Could not download attachment: ${response.status} ${response.statusText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      
      // Generate safe filename with timestamp to avoid collisions
      const timestamp = Date.now();
      const safeName = name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filePath = path.join(this.downloadDir, `${timestamp}_${safeName}`);
      
      fs.writeFileSync(filePath, buffer);
      
      console.log(`[${agentName}] Downloaded: ${filePath} (${buffer.length} bytes)`);

      return {
        path: filePath,
        name: name,
        contentType: contentType,
        size: buffer.length,
        originalUrl: contentUrl
      };
    } catch (error) {
      console.error(`[${agentName}] Failed to download ${name}:`, error.message);
      return {
        name: name,
        contentType: contentType,
        error: error.message,
        originalUrl: contentUrl
      };
    }
  }

  /**
   * Download all attachments from a Teams message
   * 
   * @param {Array} attachments - Array of attachment objects
   * @param {Object} agentConfig - Agent configuration
   * @returns {Array} Array of downloaded file info objects
   */
  async downloadAllAttachments(attachments, agentConfig) {
    const results = [];
    
    for (const attachment of attachments) {
      // Skip non-file attachments (like message cards, adaptive cards)
      if (attachment.contentType === 'application/vnd.microsoft.card.adaptive' ||
          attachment.contentType === 'application/vnd.microsoft.card.hero') {
        console.log(`[${agentConfig.agentName}] Skipping card attachment: ${attachment.contentType}`);
        continue;
      }
      
      const result = await this.downloadAttachment(attachment, agentConfig);
      results.push(result);
    }
    
    return results;
  }

  /**
   * Clean up old downloaded files (older than specified hours)
   */
  cleanupOldFiles(maxAgeHours = 24) {
    const maxAge = maxAgeHours * 60 * 60 * 1000;
    const now = Date.now();
    
    try {
      const files = fs.readdirSync(this.downloadDir);
      let cleaned = 0;
      
      for (const file of files) {
        const filePath = path.join(this.downloadDir, file);
        const stats = fs.statSync(filePath);
        
        if (now - stats.mtimeMs > maxAge) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      }
      
      if (cleaned > 0) {
        console.log(`[AttachmentDownloader] Cleaned up ${cleaned} old files`);
      }
    } catch (error) {
      console.error('[AttachmentDownloader] Cleanup error:', error.message);
    }
  }
}

module.exports = AttachmentDownloader;
