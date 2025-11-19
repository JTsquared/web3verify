require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');

// Import MongoDB database
const mongoDb = require('./src/database-mongo');

async function migrate() {
  console.log('Starting migration from SQLite to MongoDB...\n');

  // Check if SQLite database exists
  const sqlitePath = path.join(__dirname, 'data/bot.db');
  const fs = require('fs');

  if (!fs.existsSync(sqlitePath)) {
    console.log('No SQLite database found at', sqlitePath);
    console.log('Nothing to migrate. You can start fresh with MongoDB!');
    process.exit(0);
  }

  try {
    // Connect to SQLite
    const sqliteDb = new Database(sqlitePath);
    console.log('Connected to SQLite database');

    // Connect to MongoDB
    await mongoDb.initDatabase();
    console.log('Connected to MongoDB\n');

    // Migrate users and wallets
    console.log('Migrating users and wallets...');
    const sqliteUsers = sqliteDb.prepare('SELECT * FROM users').all();
    const sqliteWallets = sqliteDb.prepare('SELECT * FROM wallets').all();

    let userCount = 0;
    let walletCount = 0;

    // Migrate users first
    for (const user of sqliteUsers) {
      await mongoDb.ensureUser(user.discord_id, user.username);
      userCount++;
    }

    // Then migrate wallets
    for (const wallet of sqliteWallets) {
      await mongoDb.addWallet(
        wallet.discord_id,
        wallet.wallet_address,
        '', // Username will be filled from user table
        wallet.is_primary === 1
      );
      walletCount++;
    }

    console.log(`✓ Migrated ${userCount} users`);
    console.log(`✓ Migrated ${walletCount} wallets\n`);

    // Migrate role configurations
    console.log('Migrating role configurations...');
    const roleConfigs = sqliteDb.prepare('SELECT * FROM role_configs').all();

    for (const config of roleConfigs) {
      await mongoDb.addRoleConfig(
        config.guild_id,
        config.role_id,
        config.contract_address,
        config.token_type,
        config.min_balance,
        config.staking_contract
      );
    }

    console.log(`✓ Migrated ${roleConfigs.length} role configurations\n`);

    // Migrate verification history
    console.log('Migrating verification history...');
    const history = sqliteDb.prepare('SELECT * FROM verification_history').all();

    for (const record of history) {
      await mongoDb.logVerification(
        record.discord_id,
        record.guild_id,
        record.role_id,
        record.action,
        record.reason
      );
    }

    console.log(`✓ Migrated ${history.length} history records\n`);

    console.log('✅ Migration completed successfully!');
    console.log('\nYou can now:');
    console.log('1. Delete the data/ folder (optional backup first)');
    console.log('2. Remove better-sqlite3 from package.json (optional)');
    console.log('3. Deploy to Render with MONGODB_URI set');

    sqliteDb.close();
    process.exit(0);

  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  }
}

migrate();
