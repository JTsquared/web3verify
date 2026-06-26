const db = require('./database-mongo');
const BlockchainService = require('./blockchain');

const blockchainService = new BlockchainService(process.env.AVALANCHE_RPC_URL);

/**
 * Generate verification message (must match blaze-verify.html)
 */
function getVerificationMessage() {
  return `I am verifying my wallet for Web3Verify.\n\nBy signing this message, I prove ownership of my wallet.`;
}

/**
 * POST /api/blaze/register
 * Called by blaze_games bot when a user types !register.
 * Creates a pending registration and returns the verification URL.
 */
async function createRegistration(req, res) {
  const { blazeUsername } = req.body;

  if (!blazeUsername) {
    return res.status(400).json({ error: 'blazeUsername is required' });
  }

  try {
    const token = await db.createBlazeRegistrationToken(blazeUsername);
    const baseUrl = process.env.WEB_URL || `http://localhost:${process.env.PORT || 3000}`;
    const verifyUrl = `${baseUrl}/verify/blaze?token=${token}`;

    res.json({
      success: true,
      url: verifyUrl,
      expiresIn: '10 minutes'
    });
  } catch (error) {
    console.error('Error creating Blaze registration:', error);
    res.status(500).json({ error: 'Failed to create registration' });
  }
}

/**
 * POST /api/blaze/verify-wallet
 * Called by the blaze-verify.html page after wallet connection and signing.
 * Verifies the signature and stores the wallet, returns a confirmation code.
 */
async function verifyBlazeWallet(req, res) {
  const { token, walletAddress, signature } = req.body;

  if (!token || !walletAddress || !signature) {
    return res.status(400).json({ error: 'token, walletAddress, and signature are required' });
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return res.status(400).json({ error: 'Invalid wallet address format' });
  }

  try {
    // Check that the token exists and is valid
    const pending = await db.getPendingRegistration(token);
    if (!pending) {
      return res.status(400).json({ error: 'Invalid or expired registration token' });
    }

    // Verify the signature
    const message = getVerificationMessage();
    const isValid = blockchainService.verifySignature(message, signature, walletAddress);
    if (!isValid) {
      return res.status(400).json({ error: 'Signature verification failed' });
    }

    // Store the wallet and generate confirmation code
    const confirmationCode = await db.completeBlazeWalletVerification(token, walletAddress);
    if (!confirmationCode) {
      return res.status(400).json({ error: 'Registration token already used or expired' });
    }

    res.json({
      success: true,
      confirmationCode,
      blazeUsername: pending.blaze_username
    });
  } catch (error) {
    console.error('Error verifying Blaze wallet:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
}

/**
 * POST /api/blaze/confirm
 * Called by blaze_games bot when user types !confirm <code>.
 * Finalizes the registration.
 */
async function confirmRegistration(req, res) {
  const { blazeUsername, confirmationCode } = req.body;

  if (!blazeUsername || !confirmationCode) {
    return res.status(400).json({ error: 'blazeUsername and confirmationCode are required' });
  }

  try {
    const registration = await db.confirmBlazeRegistration(blazeUsername, confirmationCode);
    if (!registration) {
      return res.status(400).json({ error: 'Invalid confirmation code or registration expired' });
    }

    // Immediately check NFT status for the newly registered wallet
    try {
      const hasNft = await checkWalletForObeezNft(registration.wallet_address);
      await db.updateBlazeNftStatus(blazeUsername, hasNft);
      registration.holds_nft = hasNft;
    } catch (nftError) {
      console.error('Error checking NFT status during confirmation:', nftError);
      // Non-fatal - cron job will catch it later
    }

    res.json({
      success: true,
      blazeUsername: registration.blaze_username,
      walletAddress: registration.wallet_address,
      holdsNft: registration.holds_nft
    });
  } catch (error) {
    console.error('Error confirming Blaze registration:', error);
    res.status(500).json({ error: 'Confirmation failed' });
  }
}

/**
 * GET /api/blaze/check?username=<blazeUsername>
 * Called by blaze_games to check if a user holds an Obeez NFT.
 */
async function checkNftStatus(req, res) {
  const { username } = req.query;

  if (!username) {
    return res.status(400).json({ error: 'username query parameter is required' });
  }

  try {
    const registration = await db.getBlazeRegistration(username);
    if (!registration) {
      return res.json({
        registered: false,
        holdsNft: false
      });
    }

    res.json({
      registered: true,
      holdsNft: registration.holds_nft,
      walletAddress: registration.wallet_address,
      lastChecked: registration.nft_last_checked
    });
  } catch (error) {
    console.error('Error checking Blaze NFT status:', error);
    res.status(500).json({ error: 'Check failed' });
  }
}

/**
 * PUT /api/blaze/username
 * Update a Blaze username on an existing registration.
 */
async function updateUsername(req, res) {
  const { oldUsername, newUsername } = req.body;

  if (!oldUsername || !newUsername) {
    return res.status(400).json({ error: 'oldUsername and newUsername are required' });
  }

  try {
    const result = await db.updateBlazeUsername(oldUsername, newUsername);
    if (!result) {
      return res.status(400).json({ error: 'Username not found or new username already taken' });
    }

    res.json({
      success: true,
      blazeUsername: result.blaze_username
    });
  } catch (error) {
    console.error('Error updating Blaze username:', error);
    res.status(500).json({ error: 'Update failed' });
  }
}

/**
 * POST /api/blaze/register-from-discord
 * Called by the Discord verify page when a user fills in their Blaze username.
 */
async function registerFromDiscord(req, res) {
  const { blazeUsername, walletAddress, discordId } = req.body;

  if (!blazeUsername || !walletAddress || !discordId) {
    return res.status(400).json({ error: 'blazeUsername, walletAddress, and discordId are required' });
  }

  try {
    const registration = await db.registerBlazeFromDiscord(blazeUsername, walletAddress, discordId);

    // Immediately check NFT status
    try {
      const hasNft = await checkWalletForObeezNft(registration.wallet_address);
      await db.updateBlazeNftStatus(blazeUsername, hasNft);
      registration.holds_nft = hasNft;
    } catch (nftError) {
      console.error('Error checking NFT status during Discord registration:', nftError);
    }

    res.json({
      success: true,
      blazeUsername: registration.blaze_username,
      holdsNft: registration.holds_nft
    });
  } catch (error) {
    console.error('Error registering Blaze from Discord:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
}

/**
 * GET /api/blaze/token-check?token=<token>
 * Validates a registration token and returns the associated Blaze username.
 * Used by the blaze-verify.html page to verify the link is valid.
 */
async function checkToken(req, res) {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ error: 'token query parameter is required' });
  }

  try {
    const pending = await db.getPendingRegistration(token);
    if (!pending) {
      return res.status(404).json({ error: 'Invalid or expired token' });
    }

    res.json({
      valid: true,
      blazeUsername: pending.blaze_username
    });
  } catch (error) {
    console.error('Error checking token:', error);
    res.status(500).json({ error: 'Token check failed' });
  }
}

/**
 * Check if a wallet holds an Obeez NFT.
 * Looks up the Obeez contract from role configs (ERC721).
 */
async function checkWalletForObeezNft(walletAddress) {
  // Find the Obeez NFT role config - look for ERC721 configs
  const allGuilds = await db.mongoose.connection.db.collection('roleconfigs').find({
    token_type: 'ERC721'
  }).toArray();

  if (allGuilds.length === 0) {
    console.warn('No ERC721 role configs found - cannot check Obeez NFT status');
    return false;
  }

  // Check wallet against each ERC721 config (one of them should be the Obeez contract)
  for (const config of allGuilds) {
    try {
      const result = await blockchainService.checkERC721Balance(
        walletAddress,
        config.contract_address,
        config.min_balance || '1'
      );
      if (result.hasBalance) return true;
    } catch (error) {
      console.error(`Error checking ERC721 balance for ${config.contract_address}:`, error.message);
    }
  }

  return false;
}

/**
 * GET /api/blaze/holders?contractAddress=<optional>
 * Returns all registered Blaze users who hold NFTs, with their blaze_username and count.
 * If contractAddress is provided, checks that specific ERC721 contract.
 * If omitted, checks all ERC721 role configs (Obeez default behavior).
 */
async function getNftHolders(req, res) {
  try {
    const { contractAddress } = req.query;
    const allRegistrations = await db.getAllBlazeRegistrations();

    // Determine which contracts to check
    let contracts;
    if (contractAddress) {
      if (!/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
        return res.status(400).json({ error: 'Invalid contract address format' });
      }
      contracts = [contractAddress.toLowerCase()];
    } else {
      // Default: all ERC721 role configs (Obeez contracts)
      const erc721Configs = await db.mongoose.connection.db.collection('roleconfigs').find({
        token_type: 'ERC721'
      }).toArray();
      contracts = erc721Configs.map(c => c.contract_address);
    }

    if (contracts.length === 0) {
      return res.json({ success: true, holders: [] });
    }

    // When a specific contract is provided, check ALL registrations (not just holds_nft)
    // since holds_nft only tracks the Obeez contracts from role configs
    const registrations = contractAddress ? allRegistrations : allRegistrations.filter(r => r.holds_nft);

    if (registrations.length === 0) {
      return res.json({ success: true, holders: [] });
    }

    // For each registration, get their NFT count across the target contracts
    const holdersWithCounts = await Promise.all(registrations.map(async (holder) => {
      let nftCount = 0;

      for (const addr of contracts) {
        try {
          const result = await blockchainService.checkERC721Balance(
            holder.wallet_address,
            addr,
            '1'
          );
          nftCount += parseInt(result.balance) || 0;
        } catch (error) {
          // Skip failed checks
        }
      }

      return {
        blazeUsername: holder.blaze_username,
        nftCount
      };
    }));

    const activeHolders = holdersWithCounts.filter(h => h.nftCount > 0);

    res.json({ success: true, holders: activeHolders });
  } catch (error) {
    console.error('Error fetching NFT holders:', error);
    res.status(500).json({ error: 'Failed to fetch holders' });
  }
}

module.exports = {
  createRegistration,
  verifyBlazeWallet,
  confirmRegistration,
  checkNftStatus,
  checkToken,
  updateUsername,
  registerFromDiscord,
  checkWalletForObeezNft,
  getNftHolders
};
