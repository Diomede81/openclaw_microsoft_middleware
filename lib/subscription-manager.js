/**
 * Microsoft Graph Subscription Manager
 * Manages webhook subscriptions with auto-renewal
 */

const { Client } = require('@microsoft/microsoft-graph-client');
require('isomorphic-fetch');
const fs = require('fs');
const path = require('path');

class SubscriptionManager {
  constructor(config) {
    this.agentName = config.agentName;
    this.clientId = config.clientId;
    this.tenantId = config.tenantId;
    this.tokenFile = config.tokenFile;
    this.webhookBaseUrl = config.webhookBaseUrl;
    
    // Subscription definitions
    this.subscriptions = config.subscriptions || [];
    
    // Store active subscription IDs
    this.activeSubscriptions = new Map();
    
    // Initialize Graph client
    this.client = null;
  }
  
  /**
   * Get access token with auto-refresh
   */
  async getAccessToken() {
    const tokens = JSON.parse(fs.readFileSync(this.tokenFile, 'utf8'));
    const expiresAt = tokens.obtained_at + (tokens.expires_in * 1000);
    
    // Refresh if expired or expiring soon (5 min buffer)
    if (Date.now() > expiresAt - 300000) {
      console.log(`[${this.agentName}] Refreshing access token...`);
      const response = await fetch(
        `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: this.clientId,
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
      fs.writeFileSync(this.tokenFile, JSON.stringify(newTokens, null, 2));
      return newTokens.access_token;
    }
    
    return tokens.access_token;
  }
  
  /**
   * Initialize Graph client with token provider
   */
  async initializeClient() {
    const authProvider = {
      getAccessToken: async () => {
        return await this.getAccessToken();
      }
    };
    
    this.client = Client.initWithMiddleware({ authProvider });
  }
  
  /**
   * Find existing subscription by clientState
   */
  async findExistingSubscription(clientState) {
    if (!this.client) await this.initializeClient();
    
    try {
      const response = await this.client
        .api('/subscriptions')
        .get();
      
      // Find subscription matching this clientState
      const existing = response.value.find(sub => sub.clientState === clientState);
      return existing || null;
    } catch (error) {
      console.warn(`[${this.agentName}] Could not list subscriptions:`, error.message);
      return null;
    }
  }
  
  /**
   * Delete all existing subscriptions for a resource (prevents duplicates)
   */
  async deleteExistingSubscriptions(resource, notificationUrl) {
    if (!this.client) await this.initializeClient();
    
    try {
      const response = await this.client
        .api('/subscriptions')
        .get();
      
      // Find all subscriptions matching this resource and notificationUrl
      const existing = response.value.filter(sub => 
        sub.resource === resource && sub.notificationUrl === notificationUrl
      );
      
      if (existing.length > 0) {
        console.log(`[${this.agentName}] Found ${existing.length} existing subscription(s) for ${resource}`);
        
        // Sort by expiration (newest last)
        existing.sort((a, b) => new Date(a.expirationDateTime) - new Date(b.expirationDateTime));
        
        // Delete all except the newest one
        for (let i = 0; i < existing.length - 1; i++) {
          console.log(`[${this.agentName}] Deleting old subscription: ${existing[i].id}`);
          try {
            await this.client
              .api(`/subscriptions/${existing[i].id}`)
              .delete();
          } catch (delError) {
            console.warn(`[${this.agentName}] Failed to delete ${existing[i].id}:`, delError.message);
          }
        }
        
        // Return the newest one to renew it
        return existing[existing.length - 1];
      }
      
      return null;
    } catch (error) {
      console.warn(`[${this.agentName}] Could not clean duplicates:`, error.message);
      return null;
    }
  }
  
  /**
   * Create or renew a subscription (with duplicate prevention)
   */
  async ensureSubscription(subscriptionDef) {
    if (!this.client) await this.initializeClient();
    
    const { resource, changeType, notificationUrl, clientState, maxExpirationMinutes } = subscriptionDef;
    
    try {
      // Clean up duplicates first (keeps newest, deletes old ones)
      const existingSub = await this.deleteExistingSubscriptions(resource, notificationUrl);
      
      if (existingSub) {
        // Try to renew the existing subscription
        try {
          const expirationDateTime = new Date(Date.now() + maxExpirationMinutes * 60 * 1000).toISOString();
          
          const renewed = await this.client
            .api(`/subscriptions/${existingSub.id}`)
            .patch({ expirationDateTime });
          
          this.activeSubscriptions.set(clientState, renewed.id);
          console.log(`[${this.agentName}] Renewed subscription: ${clientState} (expires: ${renewed.expirationDateTime})`);
          return renewed;
        } catch (renewError) {
          console.log(`[${this.agentName}] Failed to renew ${clientState}, will create new:`, renewError.message);
          // Delete the failed subscription and create new
          try {
            await this.client
              .api(`/subscriptions/${existingSub.id}`)
              .delete();
          } catch (delError) {
            // Ignore delete errors
          }
        }
      }
      
      // Create new subscription
      const expirationDateTime = new Date(Date.now() + maxExpirationMinutes * 60 * 1000).toISOString();
      
      const subscription = await this.client
        .api('/subscriptions')
        .post({
          changeType,
          notificationUrl,
          resource,
          expirationDateTime,
          clientState
        });
      
      this.activeSubscriptions.set(clientState, subscription.id);
      console.log(`[${this.agentName}] Created subscription: ${clientState} (ID: ${subscription.id}, expires: ${subscription.expirationDateTime})`);
      
      return subscription;
      
    } catch (error) {
      console.error(`[${this.agentName}] Error managing subscription ${clientState}:`, error);
      throw error;
    }
  }
  
  /**
   * Refresh all subscriptions
   */
  async refreshAllSubscriptions() {
    console.log(`[${this.agentName}] Refreshing ${this.subscriptions.length} subscriptions...`);
    
    for (const subDef of this.subscriptions) {
      try {
        await this.ensureSubscription(subDef);
      } catch (error) {
        console.error(`[${this.agentName}] Failed to refresh ${subDef.clientState}:`, error.message);
      }
    }
  }
  
  /**
   * Start auto-renewal loop (every 5 minutes)
   */
  startAutoRenewal() {
    // Run immediately
    setTimeout(() => this.refreshAllSubscriptions(), 5000);
    
    // Then every 5 minutes
    setInterval(() => this.refreshAllSubscriptions(), 5 * 60 * 1000);
    
    console.log(`[${this.agentName}] Auto-renewal started (every 5 minutes)`);
  }
  
  /**
   * List all active subscriptions from Graph API
   */
  async listSubscriptions() {
    if (!this.client) await this.initializeClient();
    
    try {
      const response = await this.client.api('/subscriptions').get();
      return response.value || [];
    } catch (error) {
      console.error(`[${this.agentName}] Error listing subscriptions:`, error);
      return [];
    }
  }
  
  /**
   * Delete a subscription
   */
  async deleteSubscription(subscriptionId) {
    if (!this.client) await this.initializeClient();
    
    try {
      await this.client.api(`/subscriptions/${subscriptionId}`).delete();
      console.log(`[${this.agentName}] Deleted subscription: ${subscriptionId}`);
      
      // Remove from active tracking
      for (const [key, id] of this.activeSubscriptions.entries()) {
        if (id === subscriptionId) {
          this.activeSubscriptions.delete(key);
          break;
        }
      }
    } catch (error) {
      console.error(`[${this.agentName}] Error deleting subscription ${subscriptionId}:`, error);
      throw error;
    }
  }
}

module.exports = SubscriptionManager;
