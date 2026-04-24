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

// Blaze registration schema - maps Blaze usernames to verified wallets
const blazeRegistrationSchema = new mongoose.Schema({
  blaze_username: { type: String, required: true, unique: true, index: true },
  wallet_address: { type: String, required: true },
  discord_id: { type: String, default: null },
  verified_at: { type: Number, required: true },
  registered_via: { type: String, required: true, enum: ['blaze', 'discord'] },
  holds_nft: { type: Boolean, default: false },
  nft_last_checked: { type: Number, default: null }
});

// Pending Blaze registration - stores tokens and confirmation codes
const pendingBlazeRegistrationSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true, index: true },
  blaze_username: { type: String, required: true },
  wallet_address: { type: String, default: null },
  signature: { type: String, default: null },
  confirmation_code: { type: String, default: null },
  status: { type: String, required: true, enum: ['pending', 'wallet_connected', 'confirmed', 'expired'], default: 'pending' },
  created_at: { type: Number, required: true },
  expires_at: { type: Number, required: true }
});

// TTL index to auto-delete expired pending registrations after 1 hour
pendingBlazeRegistrationSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

// Models
const User = mongoose.model('User', userSchema);
const Wallet = mongoose.model('Wallet', walletSchema);
const RoleConfig = mongoose.model('RoleConfig', roleConfigSchema);
const VerificationHistory = mongoose.model('VerificationHistory', verificationHistorySchema);
const BlazeRegistration = mongoose.model('BlazeRegistration', blazeRegistrationSchema);
const PendingBlazeRegistration = mongoose.model('PendingBlazeRegistration', pendingBlazeRegistrationSchema);

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
    await BlazeRegistration.createIndexes();
    await PendingBlazeRegistration.createIndexes();

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

// Blaze registration functions

/**
 * Create a pending registration token for a Blaze user.
 * Returns the token string.
 */
async function createBlazeRegistrationToken(blazeUsername) {
  const crypto = require('crypto');
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();

  // Remove any existing pending registration for this user
  await PendingBlazeRegistration.deleteMany({ blaze_username: blazeUsername.toLowerCase() });

  const pending = new PendingBlazeRegistration({
    token,
    blaze_username: blazeUsername.toLowerCase(),
    status: 'pending',
    created_at: now,
    expires_at: now + (10 * 60 * 1000) // 10 minutes
  });

  await pending.save();
  return token;
}

/**
 * Look up a pending registration by token.
 * Returns null if not found or expired.
 */
function getPendingRegistration(token) {
  return PendingBlazeRegistration.findOne({
    token,
    status: { $in: ['pending', 'wallet_connected'] },
    expires_at: { $gt: Date.now() }
  }).lean();
}

/**
 * After wallet is connected and signature verified on the web page,
 * store the wallet address and generate a confirmation code.
 */
async function completeBlazeWalletVerification(token, walletAddress) {
  const crypto = require('crypto');
  const confirmationCode = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6-char code

  const result = await PendingBlazeRegistration.findOneAndUpdate(
    {
      token,
      status: 'pending',
      expires_at: { $gt: Date.now() }
    },
    {
      wallet_address: walletAddress.toLowerCase(),
      confirmation_code: confirmationCode,
      status: 'wallet_connected'
    },
    { new: true }
  );

  return result ? confirmationCode : null;
}

/**
 * Confirm a Blaze registration using the confirmation code.
 * Called when user types !confirm <code> in Blaze chat.
 * Creates the final BlazeRegistration record.
 */
async function confirmBlazeRegistration(blazeUsername, confirmationCode) {
  const pending = await PendingBlazeRegistration.findOne({
    blaze_username: blazeUsername.toLowerCase(),
    confirmation_code: confirmationCode.toUpperCase(),
    status: 'wallet_connected',
    expires_at: { $gt: Date.now() }
  });

  if (!pending) return null;

  // Create or update the final registration
  const registration = await BlazeRegistration.findOneAndUpdate(
    { blaze_username: blazeUsername.toLowerCase() },
    {
      blaze_username: blazeUsername.toLowerCase(),
      wallet_address: pending.wallet_address,
      verified_at: Date.now(),
      registered_via: 'blaze',
      holds_nft: false, // Will be checked by cron job
      nft_last_checked: null
    },
    { upsert: true, new: true }
  );

  // Clean up the pending record
  await PendingBlazeRegistration.deleteOne({ _id: pending._id });

  return registration;
}

/**
 * Register a Blaze username via the Discord verification flow.
 * The wallet is already verified through Discord OAuth.
 */
async function registerBlazeFromDiscord(blazeUsername, walletAddress, discordId) {
  return BlazeRegistration.findOneAndUpdate(
    { blaze_username: blazeUsername.toLowerCase() },
    {
      blaze_username: blazeUsername.toLowerCase(),
      wallet_address: walletAddress.toLowerCase(),
      discord_id: discordId,
      verified_at: Date.now(),
      registered_via: 'discord',
      holds_nft: false,
      nft_last_checked: null
    },
    { upsert: true, new: true }
  );
}

/**
 * Get a Blaze registration by username.
 */
function getBlazeRegistration(blazeUsername) {
  return BlazeRegistration.findOne({ blaze_username: blazeUsername.toLowerCase() }).lean();
}

/**
 * Get all Blaze registrations (for cron job).
 */
function getAllBlazeRegistrations() {
  return BlazeRegistration.find({}).lean();
}

/**
 * Update the NFT holding status for a Blaze registration.
 */
async function updateBlazeNftStatus(blazeUsername, holdsNft) {
  return BlazeRegistration.updateOne(
    { blaze_username: blazeUsername.toLowerCase() },
    {
      holds_nft: holdsNft,
      nft_last_checked: Date.now()
    }
  );
}

/**
 * Update the Blaze username on an existing registration.
 * Returns null if old username not found or new username is taken.
 */
async function updateBlazeUsername(oldUsername, newUsername) {
  // Check if new username is already taken
  const existing = await BlazeRegistration.findOne({ blaze_username: newUsername.toLowerCase() });
  if (existing) return null;

  const result = await BlazeRegistration.findOneAndUpdate(
    { blaze_username: oldUsername.toLowerCase() },
    { blaze_username: newUsername.toLowerCase() },
    { new: true }
  );

  return result;
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
  // Blaze registration functions
  createBlazeRegistrationToken,
  getPendingRegistration,
  completeBlazeWalletVerification,
  confirmBlazeRegistration,
  registerBlazeFromDiscord,
  getBlazeRegistration,
  getAllBlazeRegistrations,
  updateBlazeNftStatus,
  updateBlazeUsername,
  mongoose // Export mongoose for session store
};
