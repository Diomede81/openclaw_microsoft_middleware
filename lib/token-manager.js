/**
 * Token Manager - Supports both file-based and SQLite token storage
 * Automatically detects storage type based on TOKEN_DB_PATH presence
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

class TokenManager {
  constructor(config) {
    this.tokenDbPath = config.tokenDbPath;
    this.useDatabase = !!this.tokenDbPath;
    
    if (this.useDatabase) {
      this.initDatabase();
    }
  }
  
  /**
   * Initialize SQLite database for token storage
   */
  initDatabase() {
    // Ensure directory exists
    const dir = path.dirname(this.tokenDbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    this.db = new Database(this.tokenDbPath);
    
    // Create tokens table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tokens (
        agent TEXT PRIMARY KEY,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_in INTEGER,
        obtained_at INTEGER,
        token_type TEXT,
        scope TEXT,
        updated_at INTEGER NOT NULL
      )
    `);
    
    // Prepare statements
    this.getStmt = this.db.prepare('SELECT * FROM tokens WHERE agent = ?');
    this.setStmt = this.db.prepare(`
      INSERT OR REPLACE INTO tokens (agent, access_token, refresh_token, expires_in, obtained_at, token_type, scope, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.deleteStmt = this.db.prepare('DELETE FROM tokens WHERE agent = ?');
    this.listStmt = this.db.prepare('SELECT agent FROM tokens');
  }
  
  /**
   * Get tokens for an agent
   * @param {string} agent - Agent name
   * @param {string} tokenFile - Token file path (for file-based storage)
   * @returns {Object} Token object with access_token, refresh_token, etc.
   */
  getTokens(agent, tokenFile) {
    if (this.useDatabase) {
      const row = this.getStmt.get(agent.toLowerCase());
      if (!row) {
        throw new Error(`No tokens found for agent: ${agent}`);
      }
      return row;
    } else {
      // File-based storage (legacy)
      if (!tokenFile) {
        throw new Error(`Token file not specified for agent: ${agent}`);
      }
      if (!fs.existsSync(tokenFile)) {
        throw new Error(`Token file not found: ${tokenFile}`);
      }
      return JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
    }
  }
  
  /**
   * Save tokens for an agent
   * @param {string} agent - Agent name
   * @param {Object} tokens - Token object
   * @param {string} tokenFile - Token file path (for file-based storage)
   */
  setTokens(agent, tokens, tokenFile) {
    if (this.useDatabase) {
      this.setStmt.run(
        agent.toLowerCase(),
        tokens.access_token,
        tokens.refresh_token,
        tokens.expires_in || 3600,
        tokens.obtained_at || Date.now(),
        tokens.token_type || 'Bearer',
        tokens.scope || 'https://graph.microsoft.com/.default',
        Date.now()
      );
    } else {
      // File-based storage (legacy)
      if (!tokenFile) {
        throw new Error(`Token file not specified for agent: ${agent}`);
      }
      const dir = path.dirname(tokenFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2));
    }
  }
  
  /**
   * Delete tokens for an agent
   * @param {string} agent - Agent name
   * @param {string} tokenFile - Token file path (for file-based storage)
   */
  deleteTokens(agent, tokenFile) {
    if (this.useDatabase) {
      this.deleteStmt.run(agent.toLowerCase());
    } else {
      if (tokenFile && fs.existsSync(tokenFile)) {
        fs.unlinkSync(tokenFile);
      }
    }
  }
  
  /**
   * List all agents with tokens
   * @returns {Array<string>} Array of agent names
   */
  listAgents() {
    if (this.useDatabase) {
      return this.listStmt.all().map(row => row.agent);
    } else {
      // Not supported in file-based mode
      return [];
    }
  }
  
  /**
   * Close database connection (if using database)
   */
  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

module.exports = TokenManager;
