require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');

const db = require('./database-mongo');
const commands = require('./commands');
const handlers = require('./handlers');
const VerificationService = require('./verifier');
const oauth = require('./oauth');
const api = require('./api');

// Validate required environment variables
const requiredEnvVars = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'AVALANCHE_RPC_URL', 'MONGODB_URI'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars.join(', '));
  console.error('Please create a .env file with the required variables. See .env.example for reference.');
  process.exit(1);
}

// Create Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ]
});

// Register slash commands
async function registerCommands() {
  try {
    console.log('Registering slash commands...');

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    const commandData = commands.map(command => command.toJSON());

    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commandData }
    );

    console.log('Successfully registered slash commands!');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

// Handle interactions (slash commands)
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // Log the command for debugging
  console.log(`Received command: /${interaction.commandName} from ${interaction.user.username}`);

  try {
    switch (interaction.commandName) {
      case 'linkwallet':
        await handlers.handleLinkWallet(interaction);
        break;

      case 'verify':
        await handlers.handleVerify(interaction);
        break;

      case 'status':
        await handlers.handleStatus(interaction);
        break;

      case 'wallets':
        await handlers.handleWallets(interaction);
        break;

      case 'removewallet':
        await handlers.handleRemoveWallet(interaction);
        break;

      case 'addrole':
        await handlers.handleAddRole(interaction);
        break;

      case 'listroles':
        await handlers.handleListRoles(interaction);
        break;

      case 'removerole':
        await handlers.handleRemoveRole(interaction);
        break;

      case 'reverify':
        await handlers.handleReverify(interaction);
        break;

      default:
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: 'Unknown command',
            ephemeral: true
          });
        }
    }
  } catch (error) {
    console.error(`Error handling /${interaction.commandName}:`, error.message);

    try {
      const errorMessage = {
        content: 'An error occurred while processing your command.',
        ephemeral: true
      };

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(errorMessage).catch(console.error);
      } else {
        await interaction.reply(errorMessage).catch(console.error);
      }
    } catch (replyError) {
      console.error('Failed to send error message:', replyError.message);
    }
  }
});

// Bot ready event
client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log(`Bot is in ${client.guilds.cache.size} servers`);

  // Make Discord client available to Express app (for API role assignment)
  app.locals.discordClient = client;

  // Start verification service
  const verificationInterval = parseInt(process.env.VERIFICATION_INTERVAL_HOURS) || 24;
  const verifier = new VerificationService(client, process.env.AVALANCHE_RPC_URL);
  verifier.start(verificationInterval);

  console.log('Bot is ready!');
});

// Handle errors
client.on('error', error => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

// Create Express server for health checks and web interface
const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (required for Render/Heroku/etc to handle HTTPS correctly)
app.set('trust proxy', 1);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware for OAuth (using MongoDB for persistence)
app.use(session({
  secret: process.env.SESSION_SECRET || 'web3verify-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    touchAfter: 24 * 3600 // Lazy session update (seconds)
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// OAuth routes
app.get('/auth/discord', oauth.handleOAuthRedirect);
app.get('/auth/callback', oauth.handleOAuthCallback);
app.get('/auth/user', oauth.getCurrentUser);
app.post('/auth/logout', oauth.handleLogout);

// API routes for wallet verification
app.post('/api/verify', api.verifyWallet);
app.get('/api/user/status', api.getStatus);

// Bot status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    bot: client.user?.tag || 'Not connected',
    guilds: client.guilds.cache.size,
    uptime: process.uptime()
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Verification page (new OAuth-enabled version)
app.get('/verify', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/verify.html'));
});

// Root redirects to verification page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/verify.html'));
});

// Start everything in proper order
async function start() {
  try {
    // 1. Initialize MongoDB first
    console.log('Connecting to MongoDB...');
    await db.initDatabase();
    console.log('✓ MongoDB connected');

    // 2. Start Express server
    app.listen(PORT, () => {
      console.log(`✓ Web server running on port ${PORT}`);
      console.log(`  Verification page: http://localhost:${PORT}/verify`);
    });

    // 3. Register Discord commands
    console.log('Registering Discord commands...');
    await registerCommands();
    console.log('✓ Commands registered');

    // 4. Login to Discord
    console.log('Logging in to Discord...');
    await client.login(process.env.DISCORD_TOKEN);
    console.log('✓ Bot is ready!');

  } catch (error) {
    console.error('Startup failed:', error);
    process.exit(1);
  }
}

// Start the bot
start();
