const mongoose = require('mongoose');

// MongoDB Schemas
const userSchema = new mongoose.Schema({
  discord_id: { type: String, required: true, unique: true, index: true },
  username: { type: String },
  created_at: { type: Number, required: true },
  last_checked: { type: Number }
});

const walletSchema = new mongoose.Schema({
  discord_id: { type: String, required: true, index: true },
  wallet_address: { type: String, required: true },
  verified_at: { type: Number, required: true },
  is_primary: { type: Boolean, default: false }
});

// Compound index to ensure unique wallet per user
walletSchema.index({ discord_id: 1, wallet_address: 1 }, { unique: true });

const roleConfigSchema = new mongoose.Schema({
  guild_id: { type: String, required: true, index: true },
  role_id: { type: String, required: true },
  contract_address: { type: String, required: true },
  token_type: { type: String, required: true, enum: ['ERC20', 'ERC721', 'ERC1155'] },
  min_balance: { type: String, required: true },
  chain_id: { type: Number, default: 43114 },
  staking_contract: { type: String },
  created_at: { type: Number, required: true }
});

const verificationHistorySchema = new mongoose.Schema({
  discord_id: { type: String, required: true, index: true },
  guild_id: { type: String, required: true },
  role_id: { type: String, required: true },
  action: { type: String, required: true, enum: ['added', 'removed'] },
  reason: { type: String },
  timestamp: { type: Number, required: true, index: true }
});

// Models
const User = mongoose.model('User', userSchema);
const Wallet = mongoose.model('Wallet', walletSchema);
const RoleConfig = mongoose.model('RoleConfig', roleConfigSchema);
const VerificationHistory = mongoose.model('VerificationHistory', verificationHistorySchema);

// Initialize database connection
async function initDatabase() {
  try {
    const mongoUri = process.env.MONGODB_URI;

    if (!mongoUri) {
      throw new Error('MONGODB_URI environment variable is not set');
    }

    await mongoose.connect(mongoUri);
    console.log('MongoDB connected successfully');

    // Create indexes
    await User.createIndexes();
    await Wallet.createIndexes();
    await RoleConfig.createIndexes();
    await VerificationHistory.createIndexes();

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

// User functions
async function ensureUser(discordId, username) {
  try {
    const user = await User.findOneAndUpdate(
      { discord_id: discordId },
      {
        discord_id: discordId,
        username: username,
        $setOnInsert: { created_at: Date.now() }
      },
      { upsert: true, new: true }
    );
    return user;
  } catch (error) {
    console.error('Error ensuring user:', error);
    throw error;
  }
}

function getUser(discordId) {
  return User.findOne({ discord_id: discordId }).lean();
}

function getAllUsers() {
  return User.find({}).lean();
}

async function updateLastChecked(discordId) {
  return User.updateOne(
    { discord_id: discordId },
    { last_checked: Date.now() }
  );
}

// Wallet functions
async function addWallet(discordId, walletAddress, username, isPrimary = false) {
  try {
    // Ensure user exists
    await ensureUser(discordId, username);

    // Add wallet (ignore if already exists)
    const wallet = await Wallet.findOneAndUpdate(
      { discord_id: discordId, wallet_address: walletAddress.toLowerCase() },
      {
        discord_id: discordId,
        wallet_address: walletAddress.toLowerCase(),
        verified_at: Date.now(),
        is_primary: isPrimary
      },
      { upsert: true, new: true }
    );

    // If this is the first wallet, make it primary
    const walletCount = await getWalletCount(discordId);
    if (walletCount === 1) {
      await setPrimaryWallet(discordId, walletAddress);
    }

    return wallet;
  } catch (error) {
    console.error('Error adding wallet:', error);
    throw error;
  }
}

function getWallets(discordId) {
  return Wallet.find({ discord_id: discordId })
    .sort({ is_primary: -1, verified_at: 1 })
    .lean();
}

async function getWalletCount(discordId) {
  return Wallet.countDocuments({ discord_id: discordId });
}

async function removeWallet(discordId, walletAddress) {
  return Wallet.deleteOne({
    discord_id: discordId,
    wallet_address: walletAddress.toLowerCase()
  });
}

async function setPrimaryWallet(discordId, walletAddress) {
  // Remove primary from all wallets
  await Wallet.updateMany(
    { discord_id: discordId },
    { is_primary: false }
  );

  // Set new primary
  return Wallet.updateOne(
    { discord_id: discordId, wallet_address: walletAddress.toLowerCase() },
    { is_primary: true }
  );
}

function getAllWallets() {
  return Wallet.find({}).lean();
}

// Role configuration functions
async function addRoleConfig(guildId, roleId, contractAddress, tokenType, minBalance, stakingContract = null) {
  const roleConfig = new RoleConfig({
    guild_id: guildId,
    role_id: roleId,
    contract_address: contractAddress.toLowerCase(),
    token_type: tokenType,
    min_balance: minBalance,
    staking_contract: stakingContract?.toLowerCase(),
    created_at: Date.now()
  });

  return roleConfig.save();
}

function getRoleConfigs(guildId) {
  return RoleConfig.find({ guild_id: guildId }).lean();
}

function getRoleConfig(guildId, roleId) {
  return RoleConfig.find({ guild_id: guildId, role_id: roleId }).lean();
}

async function deleteRoleConfig(id) {
  return RoleConfig.deleteOne({ _id: id });
}

// Verification history functions
async function logVerification(discordId, guildId, roleId, action, reason = null) {
  const history = new VerificationHistory({
    discord_id: discordId,
    guild_id: guildId,
    role_id: roleId,
    action: action,
    reason: reason,
    timestamp: Date.now()
  });

  return history.save();
}

function getVerificationHistory(discordId, limit = 10) {
  return VerificationHistory.find({ discord_id: discordId })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
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
  getVerificationHistory,
  mongoose // Export mongoose for session store
};
