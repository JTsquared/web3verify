const db = require('./database');
const BlockchainService = require('./blockchain');

const blockchainService = new BlockchainService(process.env.AVALANCHE_RPC_URL);

/**
 * Generate verification message (must match handlers.js)
 */
function getVerificationMessage() {
  return `I am verifying my wallet for Web3Verify.\n\nBy signing this message, I prove ownership of my wallet.`;
}

/**
 * API endpoint to verify wallet from web interface
 * Auto-links wallet to Discord user via OAuth session
 */
async function verifyWallet(req, res) {
  // Check if user is authenticated via Discord OAuth
  if (!req.session.discordUser) {
    return res.status(401).json({
      error: 'Not authenticated',
      message: 'Please login with Discord first'
    });
  }

  const { walletAddress, signature } = req.body;

  // Validate inputs
  if (!walletAddress || !signature) {
    return res.status(400).json({
      error: 'Missing parameters',
      message: 'walletAddress and signature are required'
    });
  }

  // Validate wallet address format
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return res.status(400).json({
      error: 'Invalid wallet address',
      message: 'Must be a valid Ethereum address (0x...)'
    });
  }

  try {
    // Generate expected message
    const message = getVerificationMessage();

    // Verify signature
    const isValid = blockchainService.verifySignature(message, signature, walletAddress);

    if (!isValid) {
      return res.status(400).json({
        error: 'Invalid signature',
        message: 'Signature verification failed'
      });
    }

    // Add wallet to database
    const discordUser = req.session.discordUser;
    db.addWallet(discordUser.id, walletAddress, discordUser.username);
    const walletCount = db.getWalletCount(discordUser.id);

    console.log(`Wallet ${walletAddress} verified for Discord user ${discordUser.username} (${discordUser.id})`);

    // Return success
    res.json({
      success: true,
      message: 'Wallet verified successfully!',
      data: {
        walletAddress,
        walletCount,
        discordUser: {
          id: discordUser.id,
          username: discordUser.username
        }
      }
    });

  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({
      error: 'Verification failed',
      message: error.message || 'An error occurred during verification'
    });
  }
}

/**
 * Get user's verification status
 */
async function getStatus(req, res) {
  if (!req.session.discordUser) {
    return res.status(401).json({
      error: 'Not authenticated'
    });
  }

  const discordUser = req.session.discordUser;
  const wallets = db.getWallets(discordUser.id);

  res.json({
    user: discordUser,
    wallets: wallets,
    walletCount: wallets.length
  });
}

module.exports = {
  verifyWallet,
  getStatus
};
