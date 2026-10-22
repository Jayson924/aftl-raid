// Weekly raid tracker for signed-in users without a guild role, laid out like My Characters on placeholder characters.
import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { modal } from '../modal.js';
import { guestRaidList, guestCustomRaids, applyGuestMark, MAX_CUSTOM_RAIDS, MAX_CUSTOM_CLEARS } from '../guest-raid-marks.js';

const MAX_CHARACTERS = 12;
const escapeHtml = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const GuestRaidsPage = {
  async render(container) {
    this.container = container;
    this.raidForm = null;
    this.olderOpen = new Set();
    if (!dataService.isAuthenticated()) {
      container.innerHTML = `
        <div class="my-raids-page guest-raids-page">
          <h1 class="page-title">My Raids</h1>
          <p class="guest-raids-intro">Log in with Discord to keep track of your weekly raids.</p>
          <button class="btn btn-primary" id="guest-raids-login">Log in with Discord</button>
        </div>`;
      container.querySelector('#guest-raids-login').addEventListener('click', () => dataService.signInWithDiscord());
      return;
    }
    container.innerHTML = `
      <div class="my-raids-page guest-raids-page">
        <div class="mc-header">
          <h1 class="page-title">My Raids</h1>
          <button class="btn btn-primary" data-action="add" id="guest-add-character">+ Add Character</button>
        </div>
        <p class="guest-raids-intro">Mark raids as you clear them. Everything resets with the game every Saturday 00:00 SEA.</p>
        <div id="guest-raids-list"><p class="empty-state">Loading…</p></div>
      </div>`;
    const page = container.querySelector('.guest-raids-page');
    page.addEventListener('click', (e) => this.onClick(e));
    page.addEventListener('keydown', (e) => this.onKeydown(e));
    try {
      this.characters = await dataService.getGuestCharacters();
    } catch (error) {
      console.error('Error loading guest characters:', error);
      this.characters = [];
      toast.error('Could not load your raids');
    }
    this.renderList();
  },

  destroy() {
    this.container = null;
  },

  renderList() {
    const list = this.container?.querySelector('#guest-raids-list');
    if (!list) return;
    const addBtn = this.container.querySelector('#guest-add-character');
    if (addBtn) addBtn.hidden = this.characters.length >= MAX_CHARACTERS;
    list.innerHTML = this.characters.length
      ? `<div class="game-raid-cards">${this.characters.map((c) => this.renderCharacter(c)).join('')}</div>`
      : '<p class="empty-state">Add a character to start tracking. Rename it to match your character in game.</p>';
    list.querySelectorAll('.guest-raid-card').forEach((card) => this.lockCard(card, this.olderOpen.has(card.dataset.id)));
    list.querySelector('.raid-edit-name-input')?.focus();
  },

  // The friends' "This week" card for a character that never syncs: Clears and Entries stay dashes, Done is marked by hand.
  renderCharacter(character) {
    const raids = guestRaidList(character);
    return `
      <div class="game-raid-card guest-raid-card" data-id="${escapeHtml(character.id)}">
        <div class="game-raid-head">
          <span class="game-raid-char character-name-link" data-action="rename" data-tooltip-fixed="Rename">${escapeHtml(character.name)}<span class="edit-icon">✎</span></span>
          <span class="game-raid-read">Marked by hand</span>
          <button class="btn-icon raid-delete-btn guest-char-delete" data-action="delete" data-tooltip-fixed="Delete character" aria-label="Delete ${escapeHtml(character.name)}">&times;</button>
        </div>
        <div class="game-raid-scroll">${this.renderWeekTable(character, raids)}</div>
        <div class="character-personal-raids game-raid-personal">${this.renderCustomRaids(character, guestCustomRaids(character))}</div>
      </div>`;
  },

  // Rows as on My Characters; where a raid needs every stage, each stage row gets its own check.
  renderWeekTable(character, raids) {
    const dash = '<span class="game-raid-none">—</span>';
    const check = (item, label, withText) => `<span class="game-raid-done"><button type="button" class="game-raid-check${item.done ? ' checked' : ''}" data-action="mark" data-key="${escapeHtml(item.key)}" aria-pressed="${item.done}" aria-label="${escapeHtml(label)}" data-tooltip-fixed="${item.done ? 'Unmark' : 'Mark as done'}">${item.done ? '✓' : ''}</button>${withText && item.done ? '<span class="game-raid-done-text">marked</span>' : ''}</span>`;
    const rows = (list) => list.map((raid) => `
      <tr class="game-raid-row${raid.done ? ' done' : ''}">
        <td>${escapeHtml(raid.name)}</td>
        <td>${dash}</td>
        <td>${dash}</td>
        <td>${check(raid, raid.name, true)}</td>
      </tr>${raid.stages ? `
      <tr class="game-raid-stage-checks"><td colspan="4">${raid.stages.map((stage) => `<span class="game-raid-stage-check">${escapeHtml(stage.name)}${check(stage, `${raid.name} ${stage.name}`, false)}</span>`).join('')}</td></tr>` : ''}`).join('');
    const open = this.olderOpen.has(character.id);
    return `
      <table class="game-raid-table">
        <thead><tr><th>Raid</th><th>Clears</th><th>Entries</th><th>Done</th></tr></thead>
        <tbody>${rows(raids.filter((r) => r.tier < 3))}</tbody>
        <tbody>
          <tr class="game-raid-older-row"><td colspan="4">
            <button type="button" class="game-raid-older" data-action="older" aria-expanded="${open}"><span class="game-raid-chevron" aria-hidden="true"></span>Other raids</button>
          </td></tr>
        </tbody>
        <tbody class="game-raid-older-body"${open ? '' : ' hidden'}>${rows(raids.filter((r) => r.tier === 3))}</tbody>
      </table>`;
  },

  // Personal raids as on My Characters: clear counters with a progress bar, edited inline.
  renderCustomRaids(character, custom) {
    const form = this.raidForm?.characterId === character.id ? this.raidForm : null;
    const cards = custom.map((raid) => {
      if (form?.raidId === raid.id) return this.renderRaidForm(raid);
      const pct = Math.min((raid.clears / raid.maxClears) * 100, 100);
      return `
        <div class="personal-raid-card${raid.done ? ' completed' : ''}" data-raid-id="${escapeHtml(raid.id)}">
          <div class="raid-card-body">
            <div class="raid-card-top">
              <span class="raid-name-link" data-action="edit-raid">${escapeHtml(raid.name)}<span class="edit-icon">✎</span></span>
              <span class="progress-text">${raid.clears}/${raid.maxClears}</span>
            </div>
            <div class="progress-bar"><div class="progress-fill${raid.done ? ' complete' : ''}" style="width: ${pct}%"></div></div>
          </div>
          <div class="raid-counter-btns">
            <button class="btn-counter btn-decrement" data-action="step" data-delta="-1" ${raid.clears <= 0 ? 'disabled' : ''}>-</button>
            <button class="btn-counter btn-increment" data-action="step" data-delta="1" ${raid.done ? 'disabled' : ''}>+</button>
          </div>
          <button class="btn-icon raid-delete-btn" data-action="remove-raid" data-tooltip-fixed="Delete">&times;</button>
        </div>`;
    });
    if (form && !form.raidId) cards.push(this.renderRaidForm(null));
    const canAdd = !form && custom.length < MAX_CUSTOM_RAIDS;
    return `
      ${cards.length ? `<div class="personal-raid-cards">${cards.join('')}</div>` : ''}
      ${canAdd ? '<button class="btn btn-add-raid" data-action="add-raid">+ Add Raid</button>' : ''}`;
  },

  renderRaidForm(raid) {
    return `
      <div class="personal-raid-card adding" data-raid-id="${escapeHtml(raid?.id || '')}">
        <input type="text" class="raid-edit-name-input" placeholder="Raid name" maxlength="40" value="${escapeHtml(raid?.name || '')}">
        <div class="raid-edit-max">
          <span>Max</span>
          <input type="number" class="raid-edit-max-input" min="1" max="${MAX_CUSTOM_CLEARS}" value="${raid?.maxClears || 1}">
        </div>
        <div class="raid-edit-actions">
          <button class="btn btn-small btn-secondary" data-action="cancel-raid">Cancel</button>
          <button class="btn btn-small btn-primary" data-action="save-raid">${raid ? 'Save' : 'Add'}</button>
        </div>
      </div>`;
  },

  characterFor(el) {
    return this.characters.find((c) => c.id === el.closest('.guest-raid-card')?.dataset.id);
  },

  onClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target || target.disabled) return;
    const { action } = target.dataset;
    if (action === 'add') { void this.add(target); return; }
    const character = this.characterFor(target);
    if (!character) return;
    const raidId = target.closest('.personal-raid-card')?.dataset.raidId;
    if (action === 'rename') void this.rename(character);
    else if (action === 'delete') void this.remove(character);
    else if (action === 'mark') void this.mark(character, target.dataset.key);
    else if (action === 'older') this.toggleOlder(character, target);
    else if (action === 'add-raid') this.openRaidForm(character.id, null);
    else if (action === 'edit-raid') this.openRaidForm(character.id, raidId);
    else if (action === 'cancel-raid') this.openRaidForm(null);
    else if (action === 'save-raid') void this.saveRaid(character, target.closest('.personal-raid-card'));
    else if (action === 'step') void this.step(character, raidId, Number(target.dataset.delta));
    else if (action === 'remove-raid') void this.removeRaid(character, raidId);
  },

  onKeydown(e) {
    const card = e.target.closest('.personal-raid-card.adding');
    if (!card || !e.target.matches('input')) return;
    if (e.key === 'Escape') this.openRaidForm(null);
    if (e.key === 'Enter') void this.saveRaid(this.characterFor(card), card);
  },

  openRaidForm(characterId, raidId = null) {
    this.raidForm = characterId ? { characterId, raidId } : null;
    this.renderList();
  },

  toggleOlder(character, button) {
    const open = !this.olderOpen.has(character.id);
    if (open) this.olderOpen.add(character.id);
    else this.olderOpen.delete(character.id);
    button.setAttribute('aria-expanded', String(open));
    this.lockCard(button.closest('.guest-raid-card'), open);
  },

  // As on My Characters: an open Other raids group scrolls inside the card at its closed height.
  lockCard(card, open) {
    const body = card.querySelector('.game-raid-older-body');
    body.hidden = true;
    card.style.height = '';
    if (!open) return;
    card.style.height = `${card.getBoundingClientRect().height}px`;
    body.hidden = false;
  },

  async add(button) {
    button.disabled = true;
    try {
      this.characters.push(await dataService.addGuestCharacter());
      this.renderList();
    } catch (error) {
      toast.error(error.message || 'Could not add a character');
    }
    button.disabled = false;
  },

  async rename(character) {
    const name = await modal.prompt('Name this character.', { title: 'Rename', okText: 'Save', defaultValue: character.name });
    if (!name || name === character.name) return;
    try {
      await dataService.renameGuestCharacter(character.id, name);
      character.name = name.slice(0, 40);
      this.renderList();
    } catch (error) {
      toast.error(error.message || 'Could not rename');
    }
  },

  async remove(character) {
    if (!(await modal.confirm(`Delete ${escapeHtml(character.name)} and its raids?`, { title: 'Delete character', confirmText: 'Delete', danger: true }))) return;
    try {
      await dataService.deleteGuestCharacter(character.id);
      this.characters = this.characters.filter((c) => c !== character);
      this.renderList();
    } catch (error) {
      toast.error(error.message || 'Could not delete');
    }
  },

  async mark(character, key) {
    const item = guestRaidList(character).flatMap((r) => [r, ...(r.stages || [])]).find((r) => r.key === key);
    if (!item) return;
    const before = character.marks;
    character.marks = applyGuestMark(character, key, !item.done);
    this.renderList();
    try {
      character.marks = await dataService.markGuestRaid(character.id, key, !item.done);
    } catch (error) {
      character.marks = before;
      toast.error(error.message || 'Could not save');
    }
    this.renderList();
  },

  async saveRaid(character, card) {
    const name = card.querySelector('.raid-edit-name-input').value.trim();
    const maxClears = Number(card.querySelector('.raid-edit-max-input').value) || 1;
    if (!character || !name) return;
    const raidId = card.dataset.raidId;
    card.querySelectorAll('input, button').forEach((el) => { el.disabled = true; });
    try {
      const saved = raidId
        ? await dataService.updateGuestCustomRaid(character.id, raidId, name, maxClears)
        : await dataService.addGuestCustomRaid(character.id, name, maxClears);
      const others = (character.custom_raids || []).filter((r) => r.id !== saved.id);
      character.custom_raids = raidId ? character.custom_raids.map((r) => (r.id === saved.id ? saved : r)) : [...others, saved];
      this.openRaidForm(null);
    } catch (error) {
      card.querySelectorAll('input, button').forEach((el) => { el.disabled = false; });
      toast.error(error.message || 'Could not save the raid');
    }
  },

  async step(character, raidId, delta) {
    try {
      const saved = await dataService.stepGuestCustomRaid(character.id, raidId, delta);
      character.custom_raids = character.custom_raids.map((r) => (r.id === saved.id ? saved : r));
      this.renderList();
    } catch (error) {
      toast.error(error.message || 'Could not update');
    }
  },

  async removeRaid(character, raidId) {
    const raid = (character.custom_raids || []).find((r) => r.id === raidId);
    if (!raid || !(await modal.confirm(`Remove ${escapeHtml(raid.name)} from ${escapeHtml(character.name)}?`, { title: 'Remove raid', confirmText: 'Remove', danger: true }))) return;
    try {
      await dataService.removeGuestCustomRaid(character.id, raidId);
      character.custom_raids = character.custom_raids.filter((r) => r !== raid);
      this.renderList();
    } catch (error) {
      toast.error(error.message || 'Could not remove the raid');
    }
  },
};
