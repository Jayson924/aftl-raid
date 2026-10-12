/**
 * Discord OAuth Handler
 *
 * Exchanges OAuth code for user info without exposing client secret.
 * Only requests 'identify' scope - no email access.
 */
import { signSession } from '../lib/session.js';
import { sbGet, sbPost, sbPatch } from '../lib/db.js';

// The browser cannot write app_users, so login creates the row (as a guest) or refreshes
// the Discord username and avatar. A failure here must not block the login itself.
async function saveUser(user) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return;
  try {
    const id = encodeURIComponent(user.id);
    const rows = await sbGet('app_users', `discord_id=eq.${id}&select=discord_id`);
    if (rows.length) {
      await sbPatch('app_users', `discord_id=eq.${id}`, { username: user.username, avatar_url: user.avatar });
    } else {
      await sbPost('app_users', { discord_id: user.id, username: user.username, display_name: user.displayName, avatar_url: user.avatar, role: 'guest' });
    }
  } catch (e) {
    console.error('Could not save the user at login:', e);
  }
}

export async function handler(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  const { code, redirectUri } = JSON.parse(event.body || '{}');

  if (!code) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing code parameter' })
    };
  }

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Discord credentials not configured' })
    };
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri
      })
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('Token exchange failed:', errorData);
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Failed to exchange code for token' })
      };
    }

    const tokenData = await tokenResponse.json();

    // Fetch user info from Discord
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`
      }
    });

    if (!userResponse.ok) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Failed to fetch user info' })
      };
    }

    const discordUser = await userResponse.json();

    // Return only what we need - NO EMAIL
    const user = {
      id: discordUser.id,
      username: discordUser.username,
      displayName: discordUser.global_name || discordUser.username,
      avatar: discordUser.avatar
        ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
        : null
    };

    await saveUser(user);

    // The session proves this user to functions that need to know who is calling (meter-token).
    const session = process.env.SESSION_SECRET ? signSession(user.id, process.env.SESSION_SECRET) : null;
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ user, session })
    };

  } catch (error) {
    console.error('Discord auth error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}
