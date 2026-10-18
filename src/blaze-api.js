const db = require('./database-mongo');
const BlockchainService = require('./blockchain');
const crypto = require('crypto');

const blockchainService = new BlockchainService(process.env.AVALANCHE_RPC_URL);
const OBEEZ_CONTRACT_ADDRESS = '0x5e870b3d315f7a8d7089e8b829ed8c3d9cef06ef';

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }));

  return results;
}

/**
 * Generate verification message (must match blaze-verify.html)
 */
function getVerificationMessage() {
  return `I am verifying my wallet for Web3Verify.\n\nBy signing this message, I prove ownership of my wallet.`;
}

/** POST /api/blaze/refresh - force an on-chain check for a registered username. */
async function refreshNftStatus(req, res) {
  const expectedToken = process.env.WEB3VERIFY_ADMIN_TOKEN;
  const suppliedToken = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const suppliedBuffer = Buffer.from(suppliedToken);
  const expectedBuffer = Buffer.from(expectedToken || '');
  if (!expectedToken || suppliedBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const blazeUsername = String(req.body?.blazeUsername || '').trim();
  if (!blazeUsername) {
    return res.status(400).json({ error: 'blazeUsername is required' });
  }

  try {
    const registration = await db.getBlazeRegistration(blazeUsername);
    if (!registration) {
      return res.status(404).json({ error: `${blazeUsername} has no linked wallet` });
    }

    // Do not write a false result when the RPC is unavailable. Only a
    // successful balance query is authoritative enough to update saved state.
    const nftCount = await getWalletObeezNftCount(registration.wallet_address);
    await db.updateBlazeNftStatus(blazeUsername, nftCount > 0, nftCount);

    return res.json({
      success: true,
      blazeUsername: registration.blaze_username,
      walletAddress: registration.wallet_address,
      holdsNft: nftCount > 0,
      nftCount,
      nftStatusChecked: true
    });
  } catch (error) {
    console.error(`Error manually refreshing NFT status for ${blazeUsername}:`, error);
    return res.status(503).json({ error: 'NFT balance check failed; saved status was not changed', unknown: true });
  }
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

    // Immediately refresh the linked wallet's NFT status. An RPC error leaves
    // the last saved result intact and is reported as an unknown refresh.
    let nftStatusChecked = false;
    try {
      const nftCount = await getWalletObeezNftCount(registration.wallet_address);
      const hasNft = nftCount > 0;
      await db.updateBlazeNftStatus(blazeUsername, hasNft, nftCount);
      registration.holds_nft = hasNft;
      registration.nft_count = nftCount;
      nftStatusChecked = true;
    } catch (nftError) {
      console.error('Error checking NFT status during confirmation:', nftError);
      // Non-fatal - cron job will catch it later
    }

    res.json({
      success: true,
      blazeUsername: registration.blaze_username,
      walletAddress: registration.wallet_address,
      holdsNft: registration.holds_nft,
      nftCount: registration.nft_count ?? null,
      nftStatusChecked
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
      const nftCount = await getWalletObeezNftCount(registration.wallet_address);
      const hasNft = nftCount > 0;
      await db.updateBlazeNftStatus(blazeUsername, hasNft, nftCount);
      registration.holds_nft = hasNft;
      registration.nft_count = nftCount;
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
 * Checks the canonical Obeez ERC721 contract used by the Blaze holder endpoint.
 */
async function checkWalletForObeezNft(walletAddress) {
  return (await getWalletObeezNftCount(walletAddress)) > 0;
}

async function getWalletObeezNftCount(walletAddress) {
  // Keep the saved holds_nft flag aligned with the live Obeez holder endpoint.
  // Discord role configs can contain unrelated ERC721 contracts.
  try {
    const result = await blockchainService.checkERC721Balance(
      walletAddress,
      OBEEZ_CONTRACT_ADDRESS,
      '1'
    );
    return parseInt(result.balance, 10) || 0;
  } catch (error) {
    console.error(`Error checking Obeez balance for ${walletAddress}:`, error.message);
    throw error;
  }
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

    // Blaze chat uses this canonical contract for badges and voting. Serve the
    // last successfully checked counts instead of fanning out fresh RPC calls
    // every time a play page refreshes its role cache.
    if (contractAddress && contractAddress.toLowerCase() === OBEEZ_CONTRACT_ADDRESS) {
      const holders = allRegistrations
        .filter(registration => registration.holds_nft)
        .map(registration => ({
          blazeUsername: registration.blaze_username,
          // Older records predate nft_count; a confirmed holder still gets the
          // base Obeez badge until the next successful balance check.
          nftCount: Math.max(1, Number(registration.nft_count) || 0),
          lastChecked: registration.nft_last_checked || null
        }));

      return res.json({ success: true, holders, cached: true });
    }

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
      contracts = [...new Set(erc721Configs.map(c => c.contract_address))];
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
    const rpcFailures = [];
    const holdersWithCounts = await mapWithConcurrency(registrations, 3, async (holder) => {
      let nftCount = 0;

      for (const addr of contracts) {
        try {
          const result = await blockchainService.checkERC721Balance(
            holder.wallet_address,
            addr,
            '1'
          );
          nftCount += parseInt(result.balance, 10) || 0;
        } catch (error) {
          rpcFailures.push({ username: holder.blaze_username, contract: addr, message: error.message });
          return { blazeUsername: holder.blaze_username, nftCount: null };
        }
      }

      return {
        blazeUsername: holder.blaze_username,
        nftCount
      };
    });

    if (rpcFailures.length > 0) {
      console.error(`NFT holder lookup incomplete: ${rpcFailures.length} RPC check(s) failed; returning unknown instead of partial holder data`);
      return res.status(503).json({
        error: 'NFT balances are temporarily unavailable',
        unknown: true,
        failedChecks: rpcFailures.length
      });
    }

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
  refreshNftStatus,
  checkNftStatus,
  checkToken,
  updateUsername,
  registerFromDiscord,
  checkWalletForObeezNft,
  getWalletObeezNftCount,
  getNftHolders
};
