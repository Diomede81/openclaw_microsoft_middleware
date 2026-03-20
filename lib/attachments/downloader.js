/**
 * Teams Attachment Downloader
 * Downloads file attachments from Teams messages via Graph API
 * 
 * Teams attachments are hosted on SharePoint/OneDrive and require
 * authenticated access via Microsoft Graph to download.
 * 
 * Updated 2026-03-20: Added SharePoint sharing URL resolution
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
   * Encode a sharing URL for Graph API
   * See: https://learn.microsoft.com/en-us/graph/api/shares-get
   */
  encodeSharingUrl(url) {
    // Base64 encode the URL, then make it URL-safe
    const base64 = Buffer.from(url).toString('base64');
    // Replace + with -, / with _, remove trailing =
    const urlSafe = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return 'u!' + urlSafe;
  }

  /**
   * Download file via Graph API sharing endpoint
   * This handles SharePoint/OneDrive sharing URLs
   */
  async downloadViaShareLink(contentUrl, accessToken, agentName) {
    // Encode the sharing URL
    const encodedUrl = this.encodeSharingUrl(contentUrl);
    
    console.log(`[${agentName}] Resolving SharePoint sharing link...`);
    
    // Get the driveItem from the sharing link
    const shareResponse = await fetch(
      `https://graph.microsoft.com/v1.0/shares/${encodedUrl}/driveItem`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      }
    );
    
    if (!shareResponse.ok) {
      const errorText = await shareResponse.text();
      console.log(`[${agentName}] SharePoint resolve failed (${shareResponse.status}): ${errorText.substring(0, 200)}`);
      throw new Error(`SharePoint resolve failed: ${shareResponse.status}`);
    }
    
    const driveItem = await shareResponse.json();
    console.log(`[${agentName}] Resolved driveItem: ${driveItem.name} (${driveItem.size} bytes)`);
    
    // Get the download URL from the driveItem
    // The @microsoft.graph.downloadUrl is a pre-authenticated URL
    const downloadUrl = driveItem['@microsoft.graph.downloadUrl'];
    
    if (!downloadUrl) {
      // If no direct download URL, try to get content via API
      const contentResponse = await fetch(
        `https://graph.microsoft.com/v1.0/shares/${encodedUrl}/driveItem/content`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      );
      
      if (!contentResponse.ok) {
        throw new Error(`Content download failed: ${contentResponse.status}`);
      }
      
      return Buffer.from(await contentResponse.arrayBuffer());
    }
    
    // Download from the pre-authenticated URL (no auth header needed)
    console.log(`[${agentName}] Downloading from pre-authenticated URL...`);
    const downloadResponse = await fetch(downloadUrl);
    
    if (!downloadResponse.ok) {
      throw new Error(`Download failed: ${downloadResponse.status}`);
    }
    
    return Buffer.from(await downloadResponse.arrayBuffer());
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

    console.log(`[${agentName}] Downloading attachment: ${name} (type: ${contentType})`);

    try {
      const accessToken = await this.getAccessToken(agentName, tokenFile, tenantId, clientId);
      
      let buffer;
      
      // Check if this is a SharePoint/OneDrive reference
      if (contentType === 'reference' || 
          (contentUrl && (contentUrl.includes('sharepoint.com') || contentUrl.includes('1drv.ms')))) {
        // Use the sharing link endpoint
        buffer = await this.downloadViaShareLink(contentUrl, accessToken, agentName);
      } else {
        // Try direct download with auth header (for inline/hosted attachments)
        const response = await fetch(contentUrl, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': '*/*'
          }
        });

        if (!response.ok) {
          // If direct fails, try the sharing link method as fallback
          console.log(`[${agentName}] Direct download failed (${response.status}), trying SharePoint method...`);
          buffer = await this.downloadViaShareLink(contentUrl, accessToken, agentName);
        } else {
          buffer = Buffer.from(await response.arrayBuffer());
        }
      }
      
      // Generate safe filename with timestamp to avoid collisions
      const timestamp = Date.now();
      const safeName = name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filePath = path.join(this.downloadDir, `${timestamp}_${safeName}`);
      
      fs.writeFileSync(filePath, buffer);
      
      console.log(`[${agentName}] ✅ Downloaded: ${filePath} (${buffer.length} bytes)`);

      return {
        path: filePath,
        name: name,
        contentType: contentType,
        size: buffer.length,
        originalUrl: contentUrl
      };
    } catch (error) {
      console.error(`[${agentName}] ❌ Failed to download ${name}:`, error.message);
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
