# Web3Verify - Token-Gated Discord Bot

A free/near-free Discord bot for token-gated communities on Avalanche C-Chain, similar to Collab.Land.

## Features

- Wallet verification via signature
- Support for ERC20, ERC721, and ERC1155 tokens
- Staking contract support
- Automatic role assignment based on token holdings
- Periodic re-verification (every 24 hours)
- Admin commands for role configuration
- SQLite database (no external database needed)
- Free hosting compatible (Render, Railway, Fly.io)

## Tech Stack

- **Discord.js** - Discord bot framework
- **Ethers.js** - Blockchain interaction
- **SQLite** - Lightweight database
- **Node-cron** - Scheduled verification
- **Express** - Health check server

## Setup Instructions

### 1. Prerequisites

- Node.js 18+ installed
- Discord account with a bot application
- Avalanche C-Chain wallet address knowledge

### 2. Create Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application"
3. Go to "Bot" section and click "Add Bot"
4. Under "Privileged Gateway Intents", enable:
   - Server Members Intent
   - Message Content Intent (optional)
5. Copy the bot token
6. Go to "OAuth2" > "URL Generator"
   - Select scopes: `bot`, `applications.commands`
   - Select bot permissions: `Manage Roles`, `Send Messages`, `Use Slash Commands`
7. Copy the generated URL and use it to invite the bot to your server

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env` and fill in:

```env
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here
AVALANCHE_RPC_URL=https://api.avax.network/ext/bc/C/rpc
PORT=3000
VERIFICATION_INTERVAL_HOURS=24
```

### 5. Run the Bot

Development mode (with auto-restart):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## Usage Guide

### For Users

#### 1. Get Verification Message
```
/getmessage
```
This returns a message you need to sign with your wallet.

#### 2. Sign the Message

Option A: Use MyEtherWallet
1. Go to https://www.myetherwallet.com/wallet/sign
2. Connect your wallet
3. Paste the message
4. Sign and copy the signature

Option B: Use MetaMask programmatically
```javascript
const signature = await ethereum.request({
  method: 'personal_sign',
  params: [message, walletAddress]
});
```

#### 3. Verify Your Wallet
```
/verify wallet:0xYourAddress signature:0xYourSignature
```

#### 4. Check Your Status
```
/status
```

### For Admins

#### Add Token-Gated Role

ERC20 Token (fungible):
```
/addrole role:@Holder contract:0x... type:ERC20 minbalance:100
```

ERC721 NFT:
```
/addrole role:@NFTHolder contract:0x... type:ERC721 minbalance:1
```

ERC1155 Multi-Token:
```
/addrole role:@Collector contract:0x... type:ERC1155 minbalance:1:5
```
(Format: `tokenId:amount`)

With Staking Contract:
```
/addrole role:@Staker contract:0x... type:ERC20 minbalance:1000 staking:0xStakingContract
```

#### List Role Configurations
```
/listroles
```

#### Remove Role Configuration
```
/removerole id:1
```

#### Force Re-verification
```
/reverify
```

For specific user:
```
/reverify user:@someone
```

## How It Works

### Verification Flow

1. User requests verification message with `/getmessage`
2. User signs the message with their wallet
3. User submits wallet address and signature with `/verify`
4. Bot verifies signature matches wallet address
5. Bot checks token balances on Avalanche C-Chain
6. Bot assigns roles based on token holdings
7. Bot logs verification in database

### Periodic Re-verification

- Runs every 24 hours (configurable)
- Checks all verified users' token balances
- Adds roles if users acquired required tokens
- Removes roles if users no longer meet requirements
- Updates last checked timestamp
- Logs all role changes

### Database Schema

**users**
- discord_id (primary key)
- wallet_address
- verified_at
- last_checked
- username

**role_configs**
- id (auto-increment)
- guild_id
- role_id
- contract_address
- token_type (ERC20/ERC721/ERC1155)
- min_balance
- staking_contract (optional)
- created_at

**verification_history**
- id (auto-increment)
- discord_id
- guild_id
- role_id
- action (added/removed)
- reason
- timestamp

## Deployment (Free Hosting)

### Option 1: Render.com

1. Create account at [render.com](https://render.com)
2. Click "New +" > "Web Service"
3. Connect your GitHub repository
4. Configure:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Add environment variables from `.env`
5. Deploy (free tier keeps bot running 24/7)

### Option 2: Railway.app

1. Create account at [railway.app](https://railway.app)
2. Click "New Project" > "Deploy from GitHub repo"
3. Select your repository
4. Add environment variables
5. Deploy ($5 free credit/month)

### Option 3: Fly.io

1. Install Fly CLI: `brew install flyctl` (Mac) or visit [fly.io/docs/hands-on/install-flyctl/](https://fly.io/docs/hands-on/install-flyctl/)
2. Login: `fly auth login`
3. Initialize: `fly launch`
4. Set secrets: `fly secrets set DISCORD_TOKEN=...`
5. Deploy: `fly deploy`

## Cost Breakdown

### Free Tier (0-100 users)
- **Hosting**: Free (Render/Railway/Fly.io)
- **Database**: Free (SQLite included)
- **RPC**: Free (Public Avalanche RPC)
- **Total**: $0/month

### Near-Free Tier (100-1000 users)
- **Hosting**: Free or $5/month
- **Database**: Free (SQLite)
- **RPC**: Free (public) or $49/month (Alchemy/Infura for reliability)
- **Total**: $0-54/month

### Scaling (1000+ users)
- Consider MongoDB Atlas (free 512MB)
- Consider paid RPC for better rate limits
- May need dedicated server (~$5-20/month)

## Troubleshooting

### Bot not responding
- Check bot is online in Discord
- Verify bot has proper permissions in server
- Check console logs for errors

### Signature verification fails
- Ensure user signed the exact message from `/getmessage`
- Check wallet address format (must start with 0x)
- Verify signature is from the correct wallet

### Role not assigned
- Check contract address is correct
- Verify token balance on [SnowTrace](https://snowtrace.io/)
- Ensure bot has "Manage Roles" permission
- Bot's role must be higher than roles it assigns

### RPC errors
- Public RPC may be rate-limited
- Consider using Alchemy/Infura for better reliability
- Add delays between checks in `verifier.js`

## Security Considerations

- Bot never has access to private keys
- Signature verification proves wallet ownership
- All sensitive data in `.env` (never commit)
- Database is local to server
- Rate limiting on RPC calls
- Input validation on all commands

## Roadmap

- [ ] Support for multiple chains
- [ ] Web dashboard for admins
- [ ] Role composition (AND/OR logic)
- [ ] POAP integration
- [ ] Custom verification messages
- [ ] Webhook notifications
- [ ] Analytics dashboard

## License

MIT

## Support

For issues, questions, or feature requests, please open an issue on GitHub.
