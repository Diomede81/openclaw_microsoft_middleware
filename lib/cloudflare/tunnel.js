/**
 * Cloudflare Tunnel Management
 * Creates and manages Cloudflare tunnels for webhook ingress
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

class CloudflareTunnel {
  constructor(options = {}) {
    this.apiToken = options.apiToken || process.env.CLOUDFLARE_API_TOKEN;
    this.accountId = options.accountId || process.env.CLOUDFLARE_ACCOUNT_ID;
    this.zoneId = options.zoneId || process.env.CLOUDFLARE_ZONE_ID;
    this.domain = options.domain || process.env.CLOUDFLARE_DOMAIN;
    this.subdomain = options.subdomain || process.env.CLOUDFLARE_SUBDOMAIN || 'microsoft';
    this.tunnelName = options.tunnelName || process.env.CLOUDFLARE_TUNNEL_NAME || 'ms-middleware';
    this.localPort = options.localPort || process.env.PORT || 3007;
    
    this.configDir = options.configDir || path.join(process.cwd(), '.cloudflare');
    this.baseUrl = 'https://api.cloudflare.com/client/v4';
    
    // Ensure config directory exists
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }
  
  /**
   * Validate required configuration
   */
  validate() {
    const missing = [];
    if (!this.apiToken) missing.push('CLOUDFLARE_API_TOKEN');
    if (!this.accountId) missing.push('CLOUDFLARE_ACCOUNT_ID');
    if (!this.domain) missing.push('CLOUDFLARE_DOMAIN');
    
    if (missing.length > 0) {
      throw new Error(`Missing required config: ${missing.join(', ')}`);
    }
    return true;
  }
  
  /**
   * Make API request to Cloudflare
   */
  async apiRequest(method, endpoint, body = null) {
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
    
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json'
      }
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(url, options);
    const data = await response.json();
    
    if (!data.success) {
      const errors = data.errors?.map(e => e.message).join(', ') || 'Unknown error';
      throw new Error(`Cloudflare API error: ${errors}`);
    }
    
    return data.result;
  }
  
  /**
   * List existing tunnels
   */
  async listTunnels() {
    return this.apiRequest('GET', `/accounts/${this.accountId}/cfd_tunnel`);
  }
  
  /**
   * Get tunnel by name
   */
  async getTunnelByName(name) {
    const tunnels = await this.listTunnels();
    return tunnels.find(t => t.name === name && !t.deleted_at);
  }
  
  /**
   * Create a new tunnel
   */
  async createTunnel(name) {
    // Generate tunnel secret
    const secret = Buffer.from(require('crypto').randomBytes(32)).toString('base64');
    
    const tunnel = await this.apiRequest('POST', `/accounts/${this.accountId}/cfd_tunnel`, {
      name,
      tunnel_secret: secret,
      config_src: 'local'
    });
    
    // Save credentials file
    const credentials = {
      AccountTag: this.accountId,
      TunnelID: tunnel.id,
      TunnelName: tunnel.name,
      TunnelSecret: secret
    };
    
    const credPath = path.join(this.configDir, `${tunnel.id}.json`);
    fs.writeFileSync(credPath, JSON.stringify(credentials, null, 2), { mode: 0o600 });
    
    console.log(`✅ Tunnel created: ${tunnel.name} (${tunnel.id})`);
    console.log(`   Credentials saved: ${credPath}`);
    
    return { tunnel, credentials, credPath };
  }
  
  /**
   * Delete a tunnel
   */
  async deleteTunnel(tunnelId) {
    await this.apiRequest('DELETE', `/accounts/${this.accountId}/cfd_tunnel/${tunnelId}`);
    console.log(`✅ Tunnel deleted: ${tunnelId}`);
  }
  
  /**
   * Get or create tunnel
   */
  async getOrCreateTunnel() {
    let tunnel = await this.getTunnelByName(this.tunnelName);
    
    if (tunnel) {
      console.log(`Found existing tunnel: ${tunnel.name} (${tunnel.id})`);
      
      // Check if we have credentials
      const credPath = path.join(this.configDir, `${tunnel.id}.json`);
      if (!fs.existsSync(credPath)) {
        console.log(`⚠️  Credentials file missing. You may need to recreate the tunnel.`);
        console.log(`   Run: ms-middleware tunnel delete && ms-middleware tunnel create`);
      }
      
      return tunnel;
    }
    
    console.log(`Creating new tunnel: ${this.tunnelName}`);
    const result = await this.createTunnel(this.tunnelName);
    return result.tunnel;
  }
  
  /**
   * Configure tunnel DNS (CNAME record)
   */
  async configureDNS(tunnelId) {
    if (!this.zoneId) {
      // Try to get zone ID from domain
      const zones = await this.apiRequest('GET', `/zones?name=${this.domain}`);
      if (zones.length > 0) {
        this.zoneId = zones[0].id;
      } else {
        throw new Error(`Zone not found for domain: ${this.domain}. Set CLOUDFLARE_ZONE_ID manually.`);
      }
    }
    
    const hostname = `${this.subdomain}.${this.domain}`;
    const cnameTarget = `${tunnelId}.cfargotunnel.com`;
    
    // Check if record exists
    const records = await this.apiRequest('GET', 
      `/zones/${this.zoneId}/dns_records?type=CNAME&name=${hostname}`);
    
    if (records.length > 0) {
      // Update existing record
      await this.apiRequest('PUT', 
        `/zones/${this.zoneId}/dns_records/${records[0].id}`, {
          type: 'CNAME',
          name: this.subdomain,
          content: cnameTarget,
          proxied: true
        });
      console.log(`✅ DNS record updated: ${hostname} → ${cnameTarget}`);
    } else {
      // Create new record
      await this.apiRequest('POST', `/zones/${this.zoneId}/dns_records`, {
        type: 'CNAME',
        name: this.subdomain,
        content: cnameTarget,
        proxied: true
      });
      console.log(`✅ DNS record created: ${hostname} → ${cnameTarget}`);
    }
    
    return hostname;
  }
  
  /**
   * Generate cloudflared config file
   */
  generateConfig(tunnelId) {
    const hostname = `${this.subdomain}.${this.domain}`;
    const credPath = path.join(this.configDir, `${tunnelId}.json`);
    
    const config = {
      tunnel: tunnelId,
      'credentials-file': credPath,
      ingress: [
        {
          hostname: hostname,
          service: `http://localhost:${this.localPort}`
        },
        {
          service: 'http_status:404'
        }
      ]
    };
    
    // Write YAML config
    const yaml = `# Cloudflare Tunnel Configuration
# Generated by ms-middleware

tunnel: ${tunnelId}
credentials-file: ${credPath}

ingress:
  - hostname: ${hostname}
    service: http://localhost:${this.localPort}
  - service: http_status:404
`;
    
    const configPath = path.join(this.configDir, 'config.yml');
    fs.writeFileSync(configPath, yaml);
    
    console.log(`✅ Config generated: ${configPath}`);
    return configPath;
  }
  
  /**
   * Check if cloudflared is installed
   */
  isCloudflaredInstalled() {
    try {
      execSync('cloudflared --version', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Install cloudflared
   */
  installCloudflared() {
    console.log('Installing cloudflared...');
    
    const platform = process.platform;
    const arch = process.arch;
    
    if (platform === 'linux') {
      if (arch === 'x64') {
        execSync('curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /tmp/cloudflared && chmod +x /tmp/cloudflared && sudo mv /tmp/cloudflared /usr/local/bin/', { stdio: 'inherit' });
      } else if (arch === 'arm64') {
        execSync('curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o /tmp/cloudflared && chmod +x /tmp/cloudflared && sudo mv /tmp/cloudflared /usr/local/bin/', { stdio: 'inherit' });
      }
    } else if (platform === 'darwin') {
      execSync('brew install cloudflared', { stdio: 'inherit' });
    } else {
      throw new Error(`Unsupported platform: ${platform}. Install cloudflared manually.`);
    }
    
    console.log('✅ cloudflared installed');
  }
  
  /**
   * Run cloudflared tunnel
   */
  runTunnel() {
    const configPath = path.join(this.configDir, 'config.yml');
    
    if (!fs.existsSync(configPath)) {
      throw new Error('Tunnel config not found. Run: ms-middleware tunnel setup');
    }
    
    console.log('Starting cloudflared tunnel...');
    console.log(`Config: ${configPath}`);
    console.log(`URL: https://${this.subdomain}.${this.domain}`);
    console.log('');
    
    const proc = spawn('cloudflared', ['tunnel', '--config', configPath, 'run'], {
      stdio: 'inherit'
    });
    
    return proc;
  }
  
  /**
   * Generate systemd service for cloudflared
   */
  generateService() {
    const configPath = path.join(this.configDir, 'config.yml');
    const serviceName = 'cloudflared-ms-middleware';
    
    const service = `[Unit]
Description=Cloudflare Tunnel for MS Middleware
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/cloudflared tunnel --config ${configPath} run
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
    
    const serviceDir = path.join(process.env.HOME, '.config', 'systemd', 'user');
    if (!fs.existsSync(serviceDir)) {
      fs.mkdirSync(serviceDir, { recursive: true });
    }
    
    const servicePath = path.join(serviceDir, `${serviceName}.service`);
    fs.writeFileSync(servicePath, service);
    
    console.log(`✅ Service file created: ${servicePath}`);
    console.log('');
    console.log('To enable and start:');
    console.log('   systemctl --user daemon-reload');
    console.log(`   systemctl --user enable ${serviceName}`);
    console.log(`   systemctl --user start ${serviceName}`);
    
    return servicePath;
  }
  
  /**
   * Full setup: create tunnel, configure DNS, generate config
   */
  async setup() {
    this.validate();
    
    console.log('\n🚀 Setting up Cloudflare Tunnel\n');
    
    // Check cloudflared
    if (!this.isCloudflaredInstalled()) {
      console.log('cloudflared not found. Installing...');
      this.installCloudflared();
    } else {
      console.log('✅ cloudflared is installed');
    }
    
    // Get or create tunnel
    const tunnel = await this.getOrCreateTunnel();
    
    // Configure DNS
    const hostname = await this.configureDNS(tunnel.id);
    
    // Generate config
    this.generateConfig(tunnel.id);
    
    // Generate service
    this.generateService();
    
    console.log('\n✅ Tunnel setup complete!\n');
    console.log(`Public URL: https://${hostname}`);
    console.log(`Local port: ${this.localPort}`);
    console.log('');
    console.log('Next steps:');
    console.log('1. Update your .env: PUBLIC_URL=https://' + hostname);
    console.log('2. Start the tunnel: ms-middleware tunnel run');
    console.log('   Or install as service: systemctl --user start cloudflared-ms-middleware');
    console.log('');
    
    return { tunnel, hostname };
  }
  
  /**
   * Get tunnel status
   */
  async status() {
    this.validate();
    
    const tunnel = await this.getTunnelByName(this.tunnelName);
    
    if (!tunnel) {
      console.log(`No tunnel found with name: ${this.tunnelName}`);
      return null;
    }
    
    console.log('\n📡 Tunnel Status\n');
    console.log(`   Name: ${tunnel.name}`);
    console.log(`   ID: ${tunnel.id}`);
    console.log(`   Created: ${tunnel.created_at}`);
    console.log(`   Status: ${tunnel.status || 'unknown'}`);
    console.log(`   Connections: ${tunnel.connections?.length || 0}`);
    
    if (tunnel.connections?.length > 0) {
      console.log('');
      for (const conn of tunnel.connections) {
        console.log(`   - ${conn.colo_name}: ${conn.client_id}`);
      }
    }
    
    const hostname = `${this.subdomain}.${this.domain}`;
    console.log(`\n   Public URL: https://${hostname}`);
    console.log('');
    
    return tunnel;
  }
}

module.exports = CloudflareTunnel;
