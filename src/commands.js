const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

// User command: Verify wallet
const verifyCommand = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Verify your wallet to get token-gated roles')
  .addStringOption(option =>
    option
      .setName('wallet')
      .setDescription('Your Avalanche C-Chain wallet address (0x...)')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('signature')
      .setDescription('Signature from signing the verification message')
      .setRequired(true)
  );

// User command: Check status
const statusCommand = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Check your verification status and current roles');

// User command: Link wallet (new simplified command)
const linkWalletCommand = new SlashCommandBuilder()
  .setName('linkwallet')
  .setDescription('Get the link to verify and link your wallet');

// User command: List wallets
const walletsCommand = new SlashCommandBuilder()
  .setName('wallets')
  .setDescription('List all your linked wallets');

// User command: Remove wallet
const removeWalletCommand = new SlashCommandBuilder()
  .setName('removewallet')
  .setDescription('Remove a linked wallet from your account')
  .addStringOption(option =>
    option
      .setName('wallet')
      .setDescription('Wallet address to remove (0x...)')
      .setRequired(true)
  );

// Admin command: Add role requirement
const addRoleCommand = new SlashCommandBuilder()
  .setName('addrole')
  .setDescription('Add a token requirement for a Discord role (Admin only)')
  .addRoleOption(option =>
    option
      .setName('role')
      .setDescription('The Discord role to assign')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('contract')
      .setDescription('Token contract address on Avalanche C-Chain')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('type')
      .setDescription('Token standard type')
      .setRequired(true)
      .addChoices(
        { name: 'ERC20 (Fungible Token)', value: 'ERC20' },
        { name: 'ERC721 (NFT)', value: 'ERC721' },
        { name: 'ERC1155 (Multi-Token)', value: 'ERC1155' }
      )
  )
  .addStringOption(option =>
    option
      .setName('minbalance')
      .setDescription('Minimum balance required (for ERC1155 use format: tokenId:amount)')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('staking')
      .setDescription('Staking contract address (optional, if tokens are staked)')
      .setRequired(false)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

// Admin command: List role requirements
const listRolesCommand = new SlashCommandBuilder()
  .setName('listroles')
  .setDescription('List all token-gated role configurations (Admin only)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

// Admin command: Remove role requirement
const removeRoleCommand = new SlashCommandBuilder()
  .setName('removerole')
  .setDescription('Remove a token requirement configuration (Admin only)')
  .addIntegerOption(option =>
    option
      .setName('id')
      .setDescription('The configuration ID to remove (use /listroles to see IDs)')
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

// Admin command: Force re-verification
const reverifyCommand = new SlashCommandBuilder()
  .setName('reverify')
  .setDescription('Force re-verification of all users or a specific user (Admin only)')
  .addUserOption(option =>
    option
      .setName('user')
      .setDescription('Specific user to re-verify (optional)')
      .setRequired(false)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

module.exports = [
  linkWalletCommand,
  statusCommand,
  walletsCommand,
  removeWalletCommand,
  verifyCommand, // Keep for manual verification (advanced users)
  addRoleCommand,
  listRolesCommand,
  removeRoleCommand,
  reverifyCommand
];
