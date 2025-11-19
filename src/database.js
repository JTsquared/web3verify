const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log('Created data directory');
}

const db = new Database(path.join(dataDir, 'bot.db'));

// Initialize database tables
function initDatabase() {
  // Users table - stores Discord user info
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      discord_id TEXT PRIMARY KEY,
      username TEXT,
      created_at INTEGER NOT NULL,
      last_checked INTEGER
    )
  `);

  // Wallets table - stores multiple wallet addresses per user
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      verified_at INTEGER NOT NULL,
      is_primary INTEGER DEFAULT 0,
      FOREIGN KEY (discord_id) REFERENCES users(discord_id),
      UNIQUE(discord_id, wallet_address)
    )
  `);

  // Role configurations - defines what tokens/NFTs are required for roles
  db.exec(`
    CREATE TABLE IF NOT EXISTS role_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      contract_address TEXT NOT NULL,
      token_type TEXT NOT NULL CHECK(token_type IN ('ERC20', 'ERC721', 'ERC1155')),
      min_balance TEXT NOT NULL,
      chain_id INTEGER DEFAULT 43114,
      staking_contract TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  // Verification history - audit log
  db.exec(`
    CREATE TABLE IF NOT EXISTS verification_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('added', 'removed')),
      reason TEXT,
      timestamp INTEGER NOT NULL
    )
  `);

  console.log('Database initialized successfully');
}

// User functions
function ensureUser(discordId, username) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO users (discord_id, username, created_at)
    VALUES (?, ?, ?)
  `);
  stmt.run(discordId, username, Date.now());

  // Update username if changed
  const updateStmt = db.prepare('UPDATE users SET username = ? WHERE discord_id = ?');
  updateStmt.run(username, discordId);
}

function getUser(discordId) {
  const stmt = db.prepare('SELECT * FROM users WHERE discord_id = ?');
  return stmt.get(discordId);
}

function getAllUsers() {
  const stmt = db.prepare('SELECT DISTINCT discord_id, username, created_at, last_checked FROM users');
  return stmt.all();
}

function updateLastChecked(discordId) {
  const stmt = db.prepare('UPDATE users SET last_checked = ? WHERE discord_id = ?');
  return stmt.run(Date.now(), discordId);
}

// Wallet functions
function addWallet(discordId, walletAddress, username, isPrimary = false) {
  // Ensure user exists
  ensureUser(discordId, username);

  // Add wallet
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO wallets (discord_id, wallet_address, verified_at, is_primary)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(discordId, walletAddress.toLowerCase(), Date.now(), isPrimary ? 1 : 0);

  // If this is the first wallet, make it primary
  const walletCount = getWalletCount(discordId);
  if (walletCount === 1) {
    setPrimaryWallet(discordId, walletAddress);
  }

  return result;
}

function getWallets(discordId) {
  const stmt = db.prepare('SELECT * FROM wallets WHERE discord_id = ? ORDER BY is_primary DESC, verified_at ASC');
  return stmt.all(discordId);
}

function getWalletCount(discordId) {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM wallets WHERE discord_id = ?');
  return stmt.get(discordId).count;
}

function removeWallet(discordId, walletAddress) {
  const stmt = db.prepare('DELETE FROM wallets WHERE discord_id = ? AND wallet_address = ?');
  return stmt.run(discordId, walletAddress.toLowerCase());
}

function setPrimaryWallet(discordId, walletAddress) {
  // Remove primary from all wallets
  const clearStmt = db.prepare('UPDATE wallets SET is_primary = 0 WHERE discord_id = ?');
  clearStmt.run(discordId);

  // Set new primary
  const setStmt = db.prepare('UPDATE wallets SET is_primary = 1 WHERE discord_id = ? AND wallet_address = ?');
  return setStmt.run(discordId, walletAddress.toLowerCase());
}

function getAllWallets() {
  const stmt = db.prepare('SELECT * FROM wallets');
  return stmt.all();
}

// Role configuration functions
function addRoleConfig(guildId, roleId, contractAddress, tokenType, minBalance, stakingContract = null) {
  const stmt = db.prepare(`
    INSERT INTO role_configs (guild_id, role_id, contract_address, token_type, min_balance, staking_contract, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(guildId, roleId, contractAddress.toLowerCase(), tokenType, minBalance, stakingContract?.toLowerCase(), Date.now());
}

function getRoleConfigs(guildId) {
  const stmt = db.prepare('SELECT * FROM role_configs WHERE guild_id = ?');
  return stmt.all(guildId);
}

function getRoleConfig(guildId, roleId) {
  const stmt = db.prepare('SELECT * FROM role_configs WHERE guild_id = ? AND role_id = ?');
  return stmt.all(guildId, roleId);
}

function deleteRoleConfig(id) {
  const stmt = db.prepare('DELETE FROM role_configs WHERE id = ?');
  return stmt.run(id);
}

// Verification history functions
function logVerification(discordId, guildId, roleId, action, reason = null) {
  const stmt = db.prepare(`
    INSERT INTO verification_history (discord_id, guild_id, role_id, action, reason, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(discordId, guildId, roleId, action, reason, Date.now());
}

function getVerificationHistory(discordId, limit = 10) {
  const stmt = db.prepare(`
    SELECT * FROM verification_history
    WHERE discord_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `);
  return stmt.all(discordId, limit);
}

module.exports = {
  initDatabase,
  ensureUser,
  getUser,
  getAllUsers,
  updateLastChecked,
  addWallet,
  getWallets,
  getWalletCount,
  removeWallet,
  setPrimaryWallet,
  getAllWallets,
  addRoleConfig,
  getRoleConfigs,
  getRoleConfig,
  deleteRoleConfig,
  logVerification,
  getVerificationHistory
};
