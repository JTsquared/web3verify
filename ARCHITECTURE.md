# System Architecture

## Overview

Web3Verify is a Discord bot that verifies users own specific tokens/NFTs on Avalanche C-Chain and assigns Discord roles accordingly.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Discord Server                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                      │
│  │  User 1  │  │  User 2  │  │  Admin   │                      │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                      │
│       │             │             │                             │
│       │ /verify     │ /status     │ /addrole                    │
│       │             │             │                             │
└───────┼─────────────┼─────────────┼─────────────────────────────┘
        │             │             │
        ▼             ▼             ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Discord Bot (Node.js)                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                     Discord.js Client                     │   │
│  │  - Handles slash commands                                │   │
│  │  - Manages roles                                          │   │
│  │  - Listens for interactions                              │   │
│  └─────────────┬────────────────────────────────────────────┘   │
│                │                                                 │
│  ┌─────────────▼──────────┐     ┌──────────────────────────┐   │
│  │   Command Handlers     │     │  Verification Service    │   │
│  │  - handleVerify()      │     │  - Cron job (24hr)       │   │
│  │  - handleStatus()      │◄────┤  - Check all users       │   │
│  │  - handleAddRole()     │     │  - Update roles          │   │
│  │  - handleReverify()    │     │  - Log changes           │   │
│  └─────────────┬──────────┘     └───────────┬──────────────┘   │
│                │                            │                   │
│  ┌─────────────▼────────────────────────────▼──────────────┐   │
│  │              Blockchain Service (ethers.js)             │   │
│  │  - verifySignature()                                    │   │
│  │  - checkERC20Balance()                                  │   │
│  │  - checkERC721Balance()                                 │   │
│  │  - checkERC1155Balance()                                │   │
│  │  - checkStakedBalance()                                 │   │
│  └─────────────┬───────────────────────┬───────────────────┘   │
│                │                       │                        │
│  ┌─────────────▼───────────────────────▼───────────────────┐   │
│  │              Database (SQLite)                          │   │
│  │  Tables:                                                │   │
│  │  - users (discord_id, wallet_address, verified_at)     │   │
│  │  - role_configs (role_id, contract, token_type, etc)   │   │
│  │  - verification_history (audit log)                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │           Express Server (Health Checks)                │   │
│  │  - GET /health → { status: 'ok' }                       │   │
│  │  - GET / → { status, bot, guilds, uptime }              │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      │ RPC Calls
                      ▼
        ┌─────────────────────────────┐
        │   Avalanche C-Chain RPC     │
        │  api.avax.network/ext/bc/C  │
        │                             │
        │  - Read token balances      │
        │  - Read staking contracts   │
        │  - No write operations      │
        └─────────────────────────────┘
```

## Component Details

### 1. Discord.js Client
- Connects to Discord Gateway
- Registers slash commands
- Handles user interactions
- Manages guild roles
- Listens for events

### 2. Command Handlers (`src/handlers.js`)

**User Commands:**
- `/getmessage` - Generate verification message
- `/verify` - Submit wallet + signature
- `/status` - Check verification status

**Admin Commands:**
- `/addrole` - Configure token requirements
- `/listroles` - View all configurations
- `/removerole` - Delete configuration
- `/reverify` - Force re-check users

### 3. Blockchain Service (`src/blockchain.js`)

**Signature Verification:**
```javascript
verifySignature(message, signature, expectedAddress)
// Uses ethers.verifyMessage to prove wallet ownership
```

**Token Balance Checks:**
```javascript
// ERC20 - Fungible tokens
checkERC20Balance(wallet, contract, minBalance)

// ERC721 - NFTs
checkERC721Balance(wallet, contract, minBalance)

// ERC1155 - Multi-tokens
checkERC1155Balance(wallet, contract, tokenId, minBalance)

// Staking contracts
checkStakedBalance(wallet, stakingContract, minBalance)
```

### 4. Database (`src/database.js`)

**Schema:**
```sql
users (
  discord_id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  verified_at INTEGER,
  last_checked INTEGER,
  username TEXT
)

role_configs (
  id INTEGER PRIMARY KEY,
  guild_id TEXT,
  role_id TEXT,
  contract_address TEXT,
  token_type TEXT,  -- ERC20/ERC721/ERC1155
  min_balance TEXT,
  staking_contract TEXT,
  created_at INTEGER
)

verification_history (
  id INTEGER PRIMARY KEY,
  discord_id TEXT,
  guild_id TEXT,
  role_id TEXT,
  action TEXT,  -- 'added' or 'removed'
  reason TEXT,
  timestamp INTEGER
)
```

### 5. Verification Service (`src/verifier.js`)

**Cron Job Flow:**
1. Runs every 24 hours (configurable)
2. Fetches all verified users from database
3. For each user:
   - Get their wallet address
   - Fetch all guilds they're in
   - Check role requirements for each guild
   - Query blockchain for token balances
   - Add role if user gained tokens
   - Remove role if user lost tokens
   - Log all changes
4. Update last_checked timestamp
5. Report summary

**Rate Limiting:**
- 500ms delay between users
- Prevents RPC rate limit errors
- Configurable in code

### 6. Express Server (`src/index.js`)

**Endpoints:**
- `GET /` - Bot status + stats
- `GET /health` - Health check for hosting platforms

**Purpose:**
- Required by Render/Railway/Fly.io
- Keeps free tier from sleeping
- Monitoring and debugging

## Data Flow

### Verification Flow

```
User → /getmessage → Bot
Bot → Message to sign → User
User → Signs with wallet → Signature
User → /verify wallet signature → Bot
Bot → Verify signature → Blockchain Service
Bot → Check balances → Avalanche RPC
Bot → Assign roles → Discord API
Bot → Save user → Database
Bot → Confirmation → User
```

### Re-verification Flow

```
Cron (24hr) → Verification Service
Service → Get all users → Database
Service → For each user:
  Service → Get wallet → Database
  Service → Check balances → Avalanche RPC
  Service → Compare with requirements → Database
  Service → Update roles → Discord API
  Service → Log changes → Database
Service → Summary report → Console
```

### Admin Configuration Flow

```
Admin → /addrole → Bot
Bot → Validate inputs → Handler
Bot → Save config → Database
Bot → Confirmation → Admin

Future verifications use this config automatically
```

## Security Model

### Authentication
- **Wallet Ownership**: Proven via cryptographic signature
- **No Private Keys**: Never stored or transmitted
- **Message Format**: Includes Discord ID + timestamp
- **Signature Verification**: Uses ethers.js recovery

### Authorization
- **Admin Commands**: Require Discord Administrator permission
- **Role Assignment**: Bot can only manage roles below its own
- **Rate Limiting**: Built into verification service
- **Input Validation**: All user inputs sanitized

### Data Protection
- **Environment Variables**: All secrets in .env (gitignored)
- **Database**: Local SQLite, not exposed externally
- **Wallet Addresses**: Stored lowercase, validated format
- **Audit Trail**: All role changes logged

## Scalability

### Current Limits (Free Tier)
- **Users**: Up to 1000 verified users
- **Guilds**: Unlimited
- **Roles**: Unlimited per guild
- **RPC**: ~300 requests/min (public Avalanche RPC)
- **Database**: 512MB (SQLite)
- **Hosting**: Render free tier (sleeps after 15min inactivity)

### Scaling Path

**100-1000 users:**
- ✅ Free Avalanche RPC
- ✅ SQLite database
- ✅ Render free tier
- ✅ 24-hour verification cycle

**1000-5000 users:**
- 🔄 Consider paid RPC (Alchemy/Infura)
- ✅ SQLite or MongoDB Atlas free tier
- 🔄 Railway ($5/month) or Render paid ($7/month)
- ✅ 24-hour verification cycle

**5000+ users:**
- ✅ Paid RPC provider ($49+/month)
- 🔄 MongoDB Atlas paid tier
- ✅ Dedicated server ($20+/month)
- 🔄 Optimize: caching, multicall, longer intervals

### Optimization Techniques

1. **Caching**: Store balances temporarily
2. **Multicall**: Batch multiple balance checks
3. **Webhooks**: Real-time events instead of polling
4. **CDN**: Cache contract ABIs
5. **Sharding**: Multiple bot instances for large servers

## Technology Choices

### Why Discord.js?
- Official Discord library
- Active development
- Slash command support
- Guild member intents

### Why Ethers.js?
- Lightweight vs Web3.js
- Better TypeScript support
- Message signing built-in
- Modern async/await

### Why SQLite?
- Zero configuration
- No external dependencies
- Perfect for < 10K users
- Easy backups
- Portable

### Why Node-cron?
- Simple scheduling
- No external services needed
- Flexible timing
- Lightweight

### Why Express?
- Minimal web server
- Required for health checks
- Easy monitoring
- Future API expansion

## Future Enhancements

### Planned Features
- [ ] Multi-chain support (Ethereum, Polygon, etc.)
- [ ] Role composition (AND/OR logic)
- [ ] POAP integration
- [ ] Custom messages per guild
- [ ] Web dashboard for admins
- [ ] Real-time balance updates (webhooks)
- [ ] Analytics and reporting
- [ ] Export/import configurations

### Technical Improvements
- [ ] Redis caching layer
- [ ] GraphQL API
- [ ] WebSocket status updates
- [ ] Prometheus metrics
- [ ] Automated testing suite
- [ ] CI/CD pipeline
- [ ] Docker containerization
- [ ] Kubernetes deployment

## Performance Metrics

### Targets
- **Verification Speed**: < 5 seconds per user
- **Re-verification**: < 30 minutes for 1000 users
- **Uptime**: 99.9% (with paid hosting)
- **RPC Latency**: < 500ms per call
- **Database Queries**: < 10ms per query

### Monitoring
- Express health endpoints
- Console logging
- Error tracking (optional: Sentry)
- Discord webhook alerts
- UptimeRobot pings

## Conclusion

This architecture provides:
- ✅ Low cost ($0-5/month for 1000 users)
- ✅ High reliability (99%+ uptime)
- ✅ Easy deployment (Render/Railway/Fly)
- ✅ Secure verification (cryptographic signatures)
- ✅ Scalable design (can grow to 10K+ users)
- ✅ Maintainable code (modular structure)

Perfect for community managers wanting Collab.Land functionality without the monthly fees.
