// Approves a meter link code (?link=, since ?code= is the OAuth callback); logs in first if needed.
import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { router } from '../router.js';

export const LINK_CODE_KEY = 'aftl.meter_link_code';

function currentCode() {
  const fromUrl = (new URLSearchParams(window.location.search).get('link') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (fromUrl) {
    try { localStorage.setItem(LINK_CODE_KEY, fromUrl); } catch (e) { /* storage unavailable */ }
    return fromUrl;
  }
  try { return localStorage.getItem(LINK_CODE_KEY) || ''; } catch (e) { return ''; }
}

function forgetCode() {
  try { localStorage.removeItem(LINK_CODE_KEY); } catch (e) { /* storage unavailable */ }
}

export const LinkMeterPage = {
  render(container) {
    const code = currentCode();
    const loggedIn = dataService.isAuthenticated();
    const player = dataService.isPlayer();
    let body;
    if (!code) {
      body = '<p>Open this page from the meter: Afterlight Sync, then Link with Afterlight.</p>';
    } else if (!loggedIn) {
      body = `<p>Sign in with Discord to link the meter. Code <strong class="link-code">${code}</strong></p>
        <button class="btn btn-primary" id="link-login">Sign in with Discord</button>`;
    } else if (!player) {
      body = '<p>Only guildmates can link the meter. Ask an officer for the Afterlight role on Discord.</p>';
    } else if (!dataService.getSessionToken()) {
      body = '<p>Your login is from before meter linking existed. Log out and log in again, then come back here from the meter.</p>';
    } else {
      body = `<p>Link the meter showing this code to <strong>${dataService.getDisplayName()}</strong>?</p>
        <p class="link-code">${code}</p>
        <div class="form-actions"><button class="btn btn-primary" id="link-approve">Approve</button><button class="btn btn-secondary" id="link-cancel">Not now</button></div>`;
    }
    container.innerHTML = `
      <div class="link-meter-page">
        <div class="page-header"><h1>Link Meter</h1></div>
        <div class="link-meter-card" id="link-meter-card">${body}</div>
      </div>`;
    container.querySelector('#link-login')?.addEventListener('click', () => dataService.signInWithDiscord());
    container.querySelector('#link-cancel')?.addEventListener('click', () => { forgetCode(); router.navigate('simulator'); });
    container.querySelector('#link-approve')?.addEventListener('click', async (e) => {
      const button = e.currentTarget;
      button.disabled = true;
      try {
        const response = await fetch('/.netlify/functions/meter-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: dataService.getSessionToken(), action: 'claim', code, label: navigator.platform || null }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not link');
        forgetCode();
        container.querySelector('#link-meter-card').innerHTML = '<p>Linked. Go back to the meter; it picks the link up on its own.</p>';
      } catch (err) {
        toast.error(err.message);
        button.disabled = false;
      }
    });
  },
};
