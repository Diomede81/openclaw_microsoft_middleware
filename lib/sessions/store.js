/**
 * Session Store for Microsoft Middleware
 * Manages conversation history per channel/chat for context injection
 * 
 * Storage: SQLite (file-based, zero config, included with npm install)
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class SessionStore {
  constructor(options = {}) {
    this.maxMessages = options.maxMessages || 30;        // Max messages before truncation
    this.injectMessages = options.injectMessages || 10;  // Messages to inject into prompt
    this.dbPath = options.dbPath || path.join(process.cwd(), 'data', 'sessions.db');
    
    // Ensure data directory exists
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    this.db = new Database(this.dbPath);
    this._initSchema();
  }
  
  _initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT NOT NULL UNIQUE,
        agent TEXT NOT NULL,
        channel TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT
      );
      
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT NOT NULL,
        role TEXT NOT NULL,
        sender_name TEXT,
        content TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        message_id TEXT,
        FOREIGN KEY (session_key) REFERENCES sessions(session_key)
      );
      
      CREATE INDEX IF NOT EXISTS idx_messages_session_key ON messages(session_key);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_sessions_agent_channel ON sessions(agent, channel);
    `);
    
    // Prepared statements for performance
    this._stmts = {
      getSession: this.db.prepare('SELECT * FROM sessions WHERE session_key = ?'),
      createSession: this.db.prepare(`
        INSERT INTO sessions (session_key, agent, channel, chat_id, metadata)
        VALUES (?, ?, ?, ?, ?)
      `),
      updateSession: this.db.prepare(`
        UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE session_key = ?
      `),
      addMessage: this.db.prepare(`
        INSERT INTO messages (session_key, role, sender_name, content, message_id)
        VALUES (?, ?, ?, ?, ?)
      `),
      getMessages: this.db.prepare(`
        SELECT * FROM messages WHERE session_key = ?
        ORDER BY timestamp DESC LIMIT ?
      `),
      getMessageCount: this.db.prepare(`
        SELECT COUNT(*) as count FROM messages WHERE session_key = ?
      `),
      deleteOldMessages: this.db.prepare(`
        DELETE FROM messages WHERE session_key = ? AND id NOT IN (
          SELECT id FROM messages WHERE session_key = ?
          ORDER BY timestamp DESC LIMIT ?
        )
      `),
      getAllSessions: this.db.prepare(`
        SELECT s.*, 
          (SELECT COUNT(*) FROM messages WHERE session_key = s.session_key) as message_count
        FROM sessions s
        WHERE agent = ?
        ORDER BY updated_at DESC
      `)
    };
  }
  
  /**
   * Generate session key from components
   */
  static makeSessionKey(channel, agent, chatId) {
    return `${channel}:${agent}:${chatId}`;
  }
  
  /**
   * Get or create a session
   */
  getOrCreateSession(channel, agent, chatId, metadata = {}) {
    const sessionKey = SessionStore.makeSessionKey(channel, agent, chatId);
    
    let session = this._stmts.getSession.get(sessionKey);
    
    if (!session) {
      this._stmts.createSession.run(
        sessionKey,
        agent,
        channel,
        chatId,
        JSON.stringify(metadata)
      );
      session = this._stmts.getSession.get(sessionKey);
    }
    
    return {
      ...session,
      metadata: session.metadata ? JSON.parse(session.metadata) : {}
    };
  }
  
  /**
   * Add a message to session history
   */
  addMessage(sessionKey, role, content, senderName = null, messageId = null) {
    this._stmts.addMessage.run(sessionKey, role, senderName, content, messageId);
    this._stmts.updateSession.run(sessionKey);
    
    // Check if truncation needed
    const { count } = this._stmts.getMessageCount.get(sessionKey);
    if (count > this.maxMessages) {
      this._truncateMessages(sessionKey);
    }
  }
  
  /**
   * Get recent messages for context injection
   */
  getRecentMessages(sessionKey, limit = null) {
    const messages = this._stmts.getMessages.all(sessionKey, limit || this.injectMessages);
    // Reverse to get chronological order (oldest first)
    return messages.reverse();
  }
  
  /**
   * Format messages for prompt injection
   */
  formatMessagesForPrompt(sessionKey, limit = null) {
    const messages = this.getRecentMessages(sessionKey, limit);
    
    if (messages.length === 0) {
      return null;
    }
    
    const formatted = messages.map(msg => {
      const sender = msg.sender_name || (msg.role === 'user' ? 'User' : 'Assistant');
      return `[${sender}]: ${msg.content}`;
    }).join('\n');
    
    return `--- Previous conversation (${messages.length} messages) ---\n${formatted}\n--- End of previous conversation ---\n\n`;
  }
  
  /**
   * Truncate old messages, keeping only the most recent
   */
  _truncateMessages(sessionKey) {
    this._stmts.deleteOldMessages.run(sessionKey, sessionKey, this.maxMessages);
  }
  
  /**
   * Get all sessions for an agent
   */
  getAgentSessions(agent) {
    return this._stmts.getAllSessions.all(agent);
  }
  
  /**
   * Clear a session's messages (but keep session record)
   */
  clearSession(sessionKey) {
    this.db.prepare('DELETE FROM messages WHERE session_key = ?').run(sessionKey);
    this._stmts.updateSession.run(sessionKey);
  }
  
  /**
   * Delete a session entirely
   */
  deleteSession(sessionKey) {
    this.db.prepare('DELETE FROM messages WHERE session_key = ?').run(sessionKey);
    this.db.prepare('DELETE FROM sessions WHERE session_key = ?').run(sessionKey);
  }
  
  /**
   * Get session stats
   */
  getStats() {
    const sessions = this.db.prepare('SELECT COUNT(*) as count FROM sessions').get();
    const messages = this.db.prepare('SELECT COUNT(*) as count FROM messages').get();
    return {
      totalSessions: sessions.count,
      totalMessages: messages.count,
      dbPath: this.dbPath,
      maxMessages: this.maxMessages,
      injectMessages: this.injectMessages
    };
  }
  
  /**
   * Close database connection
   */
  close() {
    this.db.close();
  }
}

module.exports = SessionStore;
