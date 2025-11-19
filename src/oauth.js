const axios = require('axios');

const DISCORD_API = 'https://discord.com/api/v10';

/**
 * OAuth redirect handler - initiates Discord OAuth flow
 */
function handleOAuthRedirect(req, res) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = encodeURIComponent(process.env.OAUTH_REDIRECT_URI || 'http://localhost:3000/auth/callback');

  const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify`;

  res.redirect(discordAuthUrl);
}

/**
 * OAuth callback handler - exchanges code for access token
 */
async function handleOAuthCallback(req, res) {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send('No code provided');
  }

  try {
    // Exchange code for access token
    const tokenResponse = await axios.post(
      `${DISCORD_API}/oauth2/token`,
      new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: process.env.OAUTH_REDIRECT_URI || 'http://localhost:3000/auth/callback'
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const { access_token } = tokenResponse.data;

    // Get user info
    const userResponse = await axios.get(`${DISCORD_API}/users/@me`, {
      headers: {
        Authorization: `Bearer ${access_token}`
      }
    });

    const user = userResponse.data;

    // Store user in session
    req.session.discordUser = {
      id: user.id,
      username: user.username,
      discriminator: user.discriminator,
      avatar: user.avatar
    };

    // Redirect to verification page
    res.redirect('/verify');

  } catch (error) {
    console.error('OAuth error:', error.response?.data || error.message);
    res.status(500).send('Authentication failed. Please try again.');
  }
}

/**
 * Get current user from session
 */
function getCurrentUser(req, res) {
  if (req.session.discordUser) {
    res.json(req.session.discordUser);
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
}

/**
 * Logout - clear session
 */
function handleLogout(req, res) {
  req.session.destroy();
  res.json({ success: true });
}

module.exports = {
  handleOAuthRedirect,
  handleOAuthCallback,
  getCurrentUser,
  handleLogout
};
