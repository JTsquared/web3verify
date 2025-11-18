const cron = require('node-cron');
const db = require('./database');
const BlockchainService = require('./blockchain');

class VerificationService {
  constructor(client, rpcUrl) {
    this.client = client;
    this.blockchainService = new BlockchainService(rpcUrl);
    this.isRunning = false;
  }

  /**
   * Start the periodic verification cron job
   * Runs every 24 hours by default
   */
  start(intervalHours = 24) {
    // Cron format: minute hour day month dayOfWeek
    // Run at midnight every day for 24-hour interval
    const cronExpression = intervalHours === 24
      ? '0 0 * * *'  // Daily at midnight
      : `0 */${intervalHours} * * *`;  // Every N hours

    console.log(`Starting verification service (runs every ${intervalHours} hours)`);

    this.job = cron.schedule(cronExpression, async () => {
      await this.runVerification();
    });

    // Also run on startup after a short delay
    setTimeout(() => {
      console.log('Running initial verification check...');
      this.runVerification();
    }, 10000); // 10 seconds after startup
  }

  /**
   * Run verification for all users across all guilds
   */
  async runVerification() {
    if (this.isRunning) {
      console.log('Verification already running, skipping...');
      return;
    }

    this.isRunning = true;
    console.log(`[${new Date().toISOString()}] Starting periodic verification...`);

    try {
      const users = db.getAllUsers();
      console.log(`Checking ${users.length} verified users...`);

      let totalRolesAdded = 0;
      let totalRolesRemoved = 0;
      let errors = 0;

      for (const user of users) {
        try {
          const result = await this.verifyUser(user);
          totalRolesAdded += result.rolesAdded;
          totalRolesRemoved += result.rolesRemoved;
        } catch (error) {
          console.error(`Error verifying user ${user.discord_id}:`, error.message);
          errors++;
        }

        // Small delay to avoid rate limiting
        await this.sleep(500);
      }

      console.log(`[${new Date().toISOString()}] Verification complete!`);
      console.log(`  Roles added: ${totalRolesAdded}`);
      console.log(`  Roles removed: ${totalRolesRemoved}`);
      console.log(`  Errors: ${errors}`);

    } catch (error) {
      console.error('Error during verification run:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Verify a single user across all guilds they're in
   */
  async verifyUser(user) {
    let rolesAdded = 0;
    let rolesRemoved = 0;

    // Get all guilds the bot is in
    for (const [guildId, guild] of this.client.guilds.cache) {
      try {
        // Check if user is in this guild
        const member = await guild.members.fetch(user.discord_id).catch(() => null);
        if (!member) continue;

        // Get role configs for this guild
        const roleConfigs = db.getRoleConfigs(guildId);
        if (roleConfigs.length === 0) continue;

        // Check each role requirement
        for (const config of roleConfigs) {
          try {
            const result = await this.checkAndUpdateRole(member, user, config);
            if (result.added) rolesAdded++;
            if (result.removed) rolesRemoved++;
          } catch (error) {
            console.error(`Error checking role ${config.role_id} for user ${user.discord_id}:`, error.message);
          }
        }

        db.updateLastChecked(user.discord_id);

      } catch (error) {
        console.error(`Error processing guild ${guildId} for user ${user.discord_id}:`, error.message);
      }
    }

    return { rolesAdded, rolesRemoved };
  }

  /**
   * Check token balance and update role accordingly
   */
  async checkAndUpdateRole(member, user, roleConfig) {
    const result = { added: false, removed: false };

    try {
      // Check if user has required tokens
      const balanceCheck = await this.blockchainService.verifyTokenRequirements(
        user.wallet_address,
        roleConfig
      );

      const role = member.guild.roles.cache.get(roleConfig.role_id);
      if (!role) {
        console.log(`Role ${roleConfig.role_id} not found in guild ${member.guild.id}`);
        return result;
      }

      const hasRole = member.roles.cache.has(roleConfig.role_id);

      // Add role if user has tokens but doesn't have role
      if (balanceCheck.hasBalance && !hasRole) {
        await member.roles.add(role);
        db.logVerification(
          user.discord_id,
          member.guild.id,
          roleConfig.role_id,
          'added',
          'Periodic verification'
        );
        console.log(`Added role ${role.name} to ${user.username} (${user.discord_id})`);
        result.added = true;
      }

      // Remove role if user doesn't have tokens but has role
      if (!balanceCheck.hasBalance && hasRole) {
        await member.roles.remove(role);
        db.logVerification(
          user.discord_id,
          member.guild.id,
          roleConfig.role_id,
          'removed',
          `Insufficient balance (has: ${balanceCheck.balance}, needs: ${balanceCheck.required})`
        );
        console.log(`Removed role ${role.name} from ${user.username} (${user.discord_id})`);
        result.removed = true;
      }

    } catch (error) {
      throw error;
    }

    return result;
  }

  /**
   * Helper function to sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Stop the verification service
   */
  stop() {
    if (this.job) {
      this.job.stop();
      console.log('Verification service stopped');
    }
  }
}

module.exports = VerificationService;
