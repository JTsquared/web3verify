require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');

const db = require('./database');
const commands = require('./commands');
const handlers = require('./handlers');
const VerificationService = require('./verifier');

// Validate required environment variables
const requiredEnvVars = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'AVALANCHE_RPC_URL'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars.join(', '));
  console.error('Please create a .env file with the required variables. See .env.example for reference.');
  process.exit(1);
}

// Initialize database
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
db.initDatabase();

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

  try {
    switch (interaction.commandName) {
      case 'getmessage':
        await handlers.handleGetMessage(interaction);
        break;

      case 'verify':
        await handlers.handleVerify(interaction);
        break;

      case 'status':
        await handlers.handleStatus(interaction);
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
        await interaction.reply({
          content: 'Unknown command',
          ephemeral: true
        });
    }
  } catch (error) {
    console.error('Error handling interaction:', error);

    const errorMessage = {
      content: 'An error occurred while processing your command.',
      ephemeral: true
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(errorMessage);
    } else {
      await interaction.reply(errorMessage);
    }
  }
});

// Bot ready event
client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log(`Bot is in ${client.guilds.cache.size} servers`);

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

// Create a simple Express server for health checks (required by some hosting platforms)
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    bot: client.user?.tag || 'Not connected',
    guilds: client.guilds.cache.size,
    uptime: process.uptime()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Health check server running on port ${PORT}`);
});

// Login to Discord
registerCommands().then(() => {
  client.login(process.env.DISCORD_TOKEN);
});
