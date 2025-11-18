# Deployment Guide

## Quick Start with Render (Recommended - 100% Free)

### Step 1: Prepare Your Repository

1. Initialize git (if not already):
```bash
git init
git add .
git commit -m "Initial commit"
```

2. Push to GitHub:
```bash
gh repo create web3verify-bot --public --source=. --push
# Or create manually on github.com and push
```

### Step 2: Deploy to Render

1. Go to [render.com](https://render.com) and sign up (free)

2. Click "New +" → "Web Service"

3. Connect your GitHub repository

4. Configure the service:
   - **Name**: `web3verify-bot`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`

5. Add Environment Variables (click "Advanced" → "Add Environment Variable"):
   ```
   DISCORD_TOKEN=your_discord_bot_token
   DISCORD_CLIENT_ID=your_discord_client_id
   AVALANCHE_RPC_URL=https://api.avax.network/ext/bc/C/rpc
   PORT=3000
   VERIFICATION_INTERVAL_HOURS=24
   ```

6. Click "Create Web Service"

7. Wait for deployment (3-5 minutes)

8. Your bot is now running 24/7 for free!

### Important Notes for Render Free Tier

- Free tier spins down after 15 minutes of inactivity
- The health check endpoint (`/health`) keeps it alive
- Bot may have 1-2 minute startup delay when first accessed
- Persistent storage via SQLite is maintained
- No credit card required

## Alternative: Railway.app

### Step 1: Deploy

1. Go to [railway.app](https://railway.app)
2. Click "Start a New Project"
3. Select "Deploy from GitHub repo"
4. Choose your repository
5. Railway auto-detects Node.js

### Step 2: Configure

1. Click on your service
2. Go to "Variables" tab
3. Add environment variables:
   ```
   DISCORD_TOKEN
   DISCORD_CLIENT_ID
   AVALANCHE_RPC_URL
   PORT
   VERIFICATION_INTERVAL_HOURS
   ```

### Step 3: Deploy

- Railway automatically deploys
- You get $5 free credit/month
- No sleep/spin-down issues

## Alternative: Fly.io

### Step 1: Install Fly CLI

macOS:
```bash
brew install flyctl
```

Linux:
```bash
curl -L https://fly.io/install.sh | sh
```

Windows:
```powershell
iwr https://fly.io/install.ps1 -useb | iex
```

### Step 2: Login and Initialize

```bash
fly auth login
fly launch
```

Answer the prompts:
- App name: `web3verify-bot`
- Region: Choose closest to you
- Database: No
- Deploy now: No (we need to set secrets first)

### Step 3: Set Secrets

```bash
fly secrets set DISCORD_TOKEN="your_token"
fly secrets set DISCORD_CLIENT_ID="your_client_id"
fly secrets set AVALANCHE_RPC_URL="https://api.avax.network/ext/bc/C/rpc"
fly secrets set VERIFICATION_INTERVAL_HOURS="24"
```

### Step 4: Deploy

```bash
fly deploy
```

### Step 5: Monitor

```bash
fly logs
fly status
```

## Monitoring Your Bot

### Check if bot is online

1. Visit your deployment URL + `/health`
   - Render: `https://your-app.onrender.com/health`
   - Railway: `https://your-app.railway.app/health`
   - Fly: `https://your-app.fly.dev/health`

2. Should return: `{"status": "ok"}`

3. Visit `/` for full status:
   ```json
   {
     "status": "online",
     "bot": "YourBot#1234",
     "guilds": 5,
     "uptime": 3600
   }
   ```

### View Logs

**Render:**
- Click on your service → "Logs" tab

**Railway:**
- Click on your service → "Deployments" → Click latest → "View Logs"

**Fly:**
```bash
fly logs
```

### Common Issues

**Bot shows offline in Discord:**
- Check deployment logs
- Verify DISCORD_TOKEN is correct
- Ensure bot is invited to server with correct permissions

**Slash commands not appearing:**
- Wait 5-10 minutes for Discord to register
- Re-invite bot with `applications.commands` scope
- Check DISCORD_CLIENT_ID is correct

**Database not persisting:**
- Render: Uses ephemeral storage (free tier)
- Railway/Fly: Persistent volumes available
- Consider switching to MongoDB Atlas if needed

## Upgrading for Scale

### When to upgrade (1000+ users):

1. **Use paid RPC provider:**
   - Alchemy: https://www.alchemy.com/pricing
   - Infura: https://www.infura.io/pricing
   - Free tiers usually sufficient, paid starts at ~$49/month

2. **Upgrade hosting:**
   - Render: $7/month for always-on
   - Railway: Pay as you go ($5 credit free)
   - Fly: $1.94/month for small VM

3. **Switch to MongoDB Atlas:**
   - Free tier: 512MB (good for ~5000 users)
   - Paid: $9/month for 2GB

4. **Add monitoring:**
   - UptimeRobot (free pings)
   - Sentry (error tracking)
   - Discord webhook alerts

## Security Checklist

Before deploying to production:

- [ ] `.env` is in `.gitignore`
- [ ] Never commit secrets to git
- [ ] Use environment variables for all sensitive data
- [ ] Bot token is regenerated if accidentally exposed
- [ ] Server roles are properly configured
- [ ] Bot has minimum required permissions
- [ ] Rate limiting is in place
- [ ] Error messages don't leak sensitive info
- [ ] Database backups are configured (if using paid tier)

## Backup & Recovery

### Backup SQLite Database (important!)

If using Render free tier, database resets on restart. To backup:

1. Add a backup endpoint (not recommended for production):
```javascript
app.get('/backup', (req, res) => {
  res.download(path.join(__dirname, '../data/bot.db'));
});
```

2. Or use Railway/Fly with persistent volumes

3. Better: Switch to MongoDB Atlas for automatic backups

### Restore Database

1. Download backup
2. Replace `data/bot.db` in deployment
3. Restart service

## Cost Optimization Tips

1. **Reduce verification frequency**
   - Set `VERIFICATION_INTERVAL_HOURS=48` instead of 24
   - Saves 50% RPC calls

2. **Use public RPC initially**
   - Free for < 1000 users
   - Upgrade to paid only when needed

3. **Optimize code**
   - Add caching for token balances
   - Batch RPC requests
   - Use multicall contracts

4. **Start with free tiers**
   - Render: Free (with sleep)
   - Railway: $5/month credit free
   - MongoDB Atlas: 512MB free
   - Avalanche RPC: Free public endpoint

Total cost: **$0-5/month for up to 1000 users**

## Support & Troubleshooting

If you encounter issues:

1. Check deployment logs
2. Verify all environment variables
3. Test locally first (`npm run dev`)
4. Check Discord bot permissions
5. Verify RPC endpoint is responding
6. Open GitHub issue with error logs

Happy deploying!
