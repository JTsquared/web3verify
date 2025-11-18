const db = require('./database');
const BlockchainService = require('./blockchain');

const blockchainService = new BlockchainService(process.env.AVALANCHE_RPC_URL);

/**
 * Generate verification message for user to sign
 */
function getVerificationMessage(discordId, username) {
  return `I am verifying my wallet for Discord user ${username} (${discordId}).\n\nTimestamp: ${Date.now()}`;
}

/**
 * Handle /getmessage command
 */
async function handleGetMessage(interaction) {
  const message = getVerificationMessage(interaction.user.id, interaction.user.username);

  await interaction.reply({
    content: `**Please sign this message with your wallet:**\n\`\`\`\n${message}\n\`\`\`\n\n**How to sign:**\n1. Go to https://www.myetherwallet.com/wallet/sign\n2. Connect your wallet\n3. Paste the message above\n4. Sign it and copy the signature\n5. Use \`/verify\` with your wallet address and signature`,
    ephemeral: true
  });
}

/**
 * Handle /verify command
 */
async function handleVerify(interaction) {
  const walletAddress = interaction.options.getString('wallet');
  const signature = interaction.options.getString('signature');

  // Validate wallet address format
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return interaction.reply({
      content: 'Invalid wallet address format. Must be a valid Ethereum address (0x...)',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // Generate the expected message
    const message = getVerificationMessage(interaction.user.id, interaction.user.username);

    // Verify signature
    const isValid = blockchainService.verifySignature(message, signature, walletAddress);

    if (!isValid) {
      return interaction.editReply({
        content: 'Signature verification failed. Please make sure you signed the correct message with the wallet you provided.'
      });
    }

    // Save user to database
    db.addUser(interaction.user.id, walletAddress, interaction.user.username);

    // Check all role requirements for this guild
    const roleConfigs = db.getRoleConfigs(interaction.guild.id);

    if (roleConfigs.length === 0) {
      return interaction.editReply({
        content: 'Wallet verified successfully! However, no token-gated roles are configured yet.'
      });
    }

    // Check each role requirement
    const rolesAdded = [];
    const rolesFailed = [];

    for (const config of roleConfigs) {
      try {
        const result = await blockchainService.verifyTokenRequirements(walletAddress, config);

        if (result.hasBalance) {
          // Add role to user
          const role = interaction.guild.roles.cache.get(config.role_id);
          if (role) {
            await interaction.member.roles.add(role);
            rolesAdded.push(role.name);
            db.logVerification(interaction.user.id, interaction.guild.id, config.role_id, 'added', 'Initial verification');
          }
        } else {
          rolesFailed.push({
            role: interaction.guild.roles.cache.get(config.role_id)?.name || 'Unknown',
            reason: `Insufficient balance (has: ${result.balance}, needs: ${result.required})`
          });
        }
      } catch (error) {
        console.error(`Error checking role ${config.role_id}:`, error);
        rolesFailed.push({
          role: interaction.guild.roles.cache.get(config.role_id)?.name || 'Unknown',
          reason: 'Error checking balance'
        });
      }
    }

    db.updateLastChecked(interaction.user.id);

    let responseMessage = `Wallet \`${walletAddress}\` verified successfully!\n\n`;

    if (rolesAdded.length > 0) {
      responseMessage += `**Roles Added:** ${rolesAdded.join(', ')}\n`;
    }

    if (rolesFailed.length > 0) {
      responseMessage += `\n**Roles Not Granted:**\n`;
      rolesFailed.forEach(rf => {
        responseMessage += `- ${rf.role}: ${rf.reason}\n`;
      });
    }

    await interaction.editReply({ content: responseMessage });

  } catch (error) {
    console.error('Verification error:', error);
    await interaction.editReply({
      content: 'An error occurred during verification. Please try again later.'
    });
  }
}

/**
 * Handle /status command
 */
async function handleStatus(interaction) {
  const user = db.getUser(interaction.user.id);

  if (!user) {
    return interaction.reply({
      content: 'You have not verified your wallet yet. Use `/getmessage` to start the verification process.',
      ephemeral: true
    });
  }

  const history = db.getVerificationHistory(interaction.user.id, 5);
  const roleConfigs = db.getRoleConfigs(interaction.guild.id);

  let response = `**Your Verification Status**\n`;
  response += `Wallet: \`${user.wallet_address}\`\n`;
  response += `Verified: <t:${Math.floor(user.verified_at / 1000)}:R>\n`;
  if (user.last_checked) {
    response += `Last Checked: <t:${Math.floor(user.last_checked / 1000)}:R>\n`;
  }

  if (roleConfigs.length > 0) {
    response += `\n**Token-Gated Roles in this Server:** ${roleConfigs.length}\n`;
  }

  if (history.length > 0) {
    response += `\n**Recent Activity:**\n`;
    history.slice(0, 3).forEach(h => {
      const role = interaction.guild.roles.cache.get(h.role_id);
      response += `- ${h.action} ${role?.name || 'Unknown'} <t:${Math.floor(h.timestamp / 1000)}:R>\n`;
    });
  }

  await interaction.reply({ content: response, ephemeral: true });
}

/**
 * Handle /addrole command (Admin only)
 */
async function handleAddRole(interaction) {
  const role = interaction.options.getRole('role');
  const contractAddress = interaction.options.getString('contract');
  const tokenType = interaction.options.getString('type');
  const minBalance = interaction.options.getString('minbalance');
  const stakingContract = interaction.options.getString('staking');

  // Validate contract address
  if (!/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
    return interaction.reply({
      content: 'Invalid contract address format. Must be a valid Ethereum address (0x...)',
      ephemeral: true
    });
  }

  if (stakingContract && !/^0x[a-fA-F0-9]{40}$/.test(stakingContract)) {
    return interaction.reply({
      content: 'Invalid staking contract address format. Must be a valid Ethereum address (0x...)',
      ephemeral: true
    });
  }

  try {
    db.addRoleConfig(
      interaction.guild.id,
      role.id,
      contractAddress,
      tokenType,
      minBalance,
      stakingContract
    );

    let response = `Role configuration added successfully!\n\n`;
    response += `**Role:** ${role.name}\n`;
    response += `**Token Type:** ${tokenType}\n`;
    response += `**Contract:** \`${contractAddress}\`\n`;
    response += `**Min Balance:** ${minBalance}\n`;
    if (stakingContract) {
      response += `**Staking Contract:** \`${stakingContract}\`\n`;
    }

    await interaction.reply({ content: response, ephemeral: true });
  } catch (error) {
    console.error('Error adding role config:', error);
    await interaction.reply({
      content: 'Error adding role configuration. Please check the console logs.',
      ephemeral: true
    });
  }
}

/**
 * Handle /listroles command (Admin only)
 */
async function handleListRoles(interaction) {
  const roleConfigs = db.getRoleConfigs(interaction.guild.id);

  if (roleConfigs.length === 0) {
    return interaction.reply({
      content: 'No token-gated roles configured yet. Use `/addrole` to add one.',
      ephemeral: true
    });
  }

  let response = `**Token-Gated Role Configurations:**\n\n`;

  roleConfigs.forEach(config => {
    const role = interaction.guild.roles.cache.get(config.role_id);
    response += `**ID:** ${config.id}\n`;
    response += `**Role:** ${role?.name || 'Deleted Role'}\n`;
    response += `**Type:** ${config.token_type}\n`;
    response += `**Contract:** \`${config.contract_address}\`\n`;
    response += `**Min Balance:** ${config.min_balance}\n`;
    if (config.staking_contract) {
      response += `**Staking:** \`${config.staking_contract}\`\n`;
    }
    response += `\n`;
  });

  await interaction.reply({ content: response, ephemeral: true });
}

/**
 * Handle /removerole command (Admin only)
 */
async function handleRemoveRole(interaction) {
  const configId = interaction.options.getInteger('id');

  try {
    db.deleteRoleConfig(configId);
    await interaction.reply({
      content: `Role configuration ID ${configId} removed successfully.`,
      ephemeral: true
    });
  } catch (error) {
    console.error('Error removing role config:', error);
    await interaction.reply({
      content: 'Error removing role configuration. Make sure the ID is correct.',
      ephemeral: true
    });
  }
}

/**
 * Handle /reverify command (Admin only)
 */
async function handleReverify(interaction) {
  const targetUser = interaction.options.getUser('user');

  await interaction.deferReply({ ephemeral: true });

  try {
    const usersToCheck = targetUser
      ? [db.getUser(targetUser.id)].filter(Boolean)
      : db.getAllUsers();

    if (usersToCheck.length === 0) {
      return interaction.editReply({
        content: 'No verified users found.'
      });
    }

    const roleConfigs = db.getRoleConfigs(interaction.guild.id);
    if (roleConfigs.length === 0) {
      return interaction.editReply({
        content: 'No token-gated roles configured.'
      });
    }

    let rolesAdded = 0;
    let rolesRemoved = 0;

    for (const user of usersToCheck) {
      const member = await interaction.guild.members.fetch(user.discord_id).catch(() => null);
      if (!member) continue;

      for (const config of roleConfigs) {
        try {
          const result = await blockchainService.verifyTokenRequirements(user.wallet_address, config);
          const role = interaction.guild.roles.cache.get(config.role_id);
          if (!role) continue;

          const hasRole = member.roles.cache.has(config.role_id);

          if (result.hasBalance && !hasRole) {
            await member.roles.add(role);
            db.logVerification(user.discord_id, interaction.guild.id, config.role_id, 'added', 'Admin re-verification');
            rolesAdded++;
          } else if (!result.hasBalance && hasRole) {
            await member.roles.remove(role);
            db.logVerification(user.discord_id, interaction.guild.id, config.role_id, 'removed', 'Insufficient balance');
            rolesRemoved++;
          }
        } catch (error) {
          console.error(`Error checking user ${user.discord_id}:`, error);
        }
      }

      db.updateLastChecked(user.discord_id);
    }

    await interaction.editReply({
      content: `Re-verification complete!\nRoles added: ${rolesAdded}\nRoles removed: ${rolesRemoved}`
    });

  } catch (error) {
    console.error('Re-verification error:', error);
    await interaction.editReply({
      content: 'An error occurred during re-verification.'
    });
  }
}

module.exports = {
  handleGetMessage,
  handleVerify,
  handleStatus,
  handleAddRole,
  handleListRoles,
  handleRemoveRole,
  handleReverify
};
