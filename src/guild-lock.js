// Guildmate-only perks shown locked to everyone else; styles in _utilities.scss.

export const GUILD_ONLY_TAG = '<span class="guild-only-tag">Guildmates only</span>';

export function guildLockedPanel(title, what) {
  return `
    <div class="guild-locked-panel">
      <h3>🔒 ${title}</h3>
      <p>${what} are for Afterlight guildmates.</p>
      <p>Raiding with us already? Ask an officer about joining the guild.</p>
    </div>`;
}
