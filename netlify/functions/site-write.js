// Every save the site makes goes through here: the session says who is calling, each action
// checks what that user may change, and the write uses the service key. With the browser's
// write access removed (supabase/lockdown-users-characters.sql), this is the only way in.
// POST {session, action, ...args}.
import { verifySession } from '../lib/session.js';
import { sbGet, sbPost, sbPatch, sbDelete, sbUpsert, sbRpc, json } from '../lib/db.js';
import { calculatePanel } from '../lib/sync-merge.js';
import { deriveColumns } from '../lib/sync-derive.js';

const enc = encodeURIComponent;
const MAX_BODY = 512 * 1024;
const ROLES = ['guest', 'friend', 'guildmate', 'editor', 'admin'];
// Lowest role per action; unlisted actions check ownership or editor/admin themselves.
const MIN_ROLE = {
  'player.add': 'friend', 'player.update': 'friend', 'player.raidCompletion': 'friend',
  'player.setGroup': 'friend', 'player.saveOrder': 'friend',
  'raids.add': 'friend', 'raids.update': 'friend', 'raids.step': 'friend', 'raids.delete': 'friend',
  'groups.add': 'friend', 'groups.rename': 'friend', 'groups.delete': 'friend', 'groups.reorder': 'friend',
  'cards.set': 'guildmate', 'extras.add': 'guildmate', 'extras.setAmount': 'guildmate',
  'shopping.add': 'guildmate', 'shopping.update': 'guildmate', 'shopping.delete': 'guildmate',
  'builds.save': 'guildmate', 'builds.delete': 'guildmate',
};
const rank = (role) => ROLES.indexOf(role);
const COMPLETION_COLUMNS = new Set(['bdn_classic_completed', 'ddn_hardcore_completed', 'ddn_classic_completed', 'ddn_normal_completed']);
// Raids only marked by hand (no lineup raid type); supabase/add-raid-marks.sql adds them.
const MARK_ONLY_COLUMNS = new Set(['bdn_memoria_completed', 'bdn_hardcore_completed', 'abyssal_mire_completed', 'dragon_fellowship_completed']);
const RARITIES = new Set(['magic', 'rare', 'epic', 'unique', 'legend']);
const COMPLETION_BY_RAID = {
  'DDN Hardcore': 'ddn_hardcore_completed', 'DDN Classic': 'ddn_classic_completed',
  'DDN Normal': 'ddn_normal_completed', 'BDN Classic': 'bdn_classic_completed',
};

// Character fields a form may set; the gear set only while the character is not synced.
const PLAYER_FIELDS = ['name', 'notes', 'account_number', 'exclude', 'exclude_label', 'exclude_reason'];
const PLAYER_GEAR_FIELDS = ['role', 'weapon', 'weapon_enhance', 'suffix1', 'suffix2', 'armor', 'armor_enhance', 'equipment', 'character_stats'];
// character_stats keys a hand-built character may type from the game window.
const HAND_STATS = ['attackPower', 'magicAttack', 'finalDamage', 'hp', 'defense', 'magicDefense',
  'criticalRate', 'criticalDamage', 'fireAttack', 'iceAttack', 'lightAttack', 'darkAttack'];

// A character built in the simulator window: the panel is calculated as for a sync; typed stats stay on top.
function handBuiltFields(a, overrides) {
  const build = a.build;
  if (!build || typeof build !== 'object' || Array.isArray(build)) return {};
  const typed = Object.fromEntries(HAND_STATS
    .filter((k) => a.hand_stats?.[k] !== null && a.hand_stats?.[k] !== '' && Number.isFinite(Number(a.hand_stats?.[k])))
    .map((k) => [k, Number(a.hand_stats[k])]));
  const panel = calculatePanel(build);
  const derived = deriveColumns(build, panel, build.second_job);
  const equipment = derived.equipment || {};
  const enhance = (piece) => (piece?.enhancement ? String(piece.enhancement) : '');
  return {
    build, panel, equipment,
    character_stats: { ...(derived.character_stats || {}), ...typed },
    suffix1: derived.suffix1 || '', suffix2: derived.suffix2 || '',
    weapon: equipment.mainWeapon?.rarity || '', weapon_enhance: enhance(equipment.mainWeapon),
    armor: equipment.helmet?.rarity || '', armor_enhance: enhance(equipment.helmet),
    overrides: { ...(overrides || {}), hand_stats: typed },
  };
}

class Denied extends Error {}
const deny = (message) => { throw new Denied(message); };
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj && obj[k] !== undefined).map((k) => [k, obj[k]]));
const one = async (table, query) => (await sbGet(table, query))[0] || null;

function ownerId() {
  return process.env.OWNER_DISCORD_ID || process.env.VITE_OWNER_DISCORD_ID || '';
}

// The caller and helpers that answer "may they touch this?".
async function context(discordId) {
  const user = await one('app_users', `discord_id=eq.${enc(discordId)}&select=discord_id,role`);
  const role = user?.role || 'guest';
  const isAdmin = role === 'admin';
  const ctx = {
    id: discordId,
    role,
    isAdmin,
    isEditor: isAdmin || role === 'editor',
    requireAdmin() { if (!isAdmin) deny('Admins only'); },
    requireEditor() { if (!ctx.isEditor) deny('Editors and admins only'); },
    // A character the caller owns; admins may act on anyone's unless ownerOnly.
    async player(playerId, { ownerOnly = false } = {}) {
      const p = await one('players', `id=eq.${enc(playerId)}&select=id,discord_id,synced_at,overrides`);
      if (!p) deny('No such character');
      if (p.discord_id !== discordId && (ownerOnly || !isAdmin)) deny('Not your character');
      return p;
    },
    // A row in a per-user table that belongs to the caller.
    async own(table, id) {
      const row = await one(table, `id=eq.${enc(id)}&select=*`);
      if (!row || row.discord_id !== discordId) deny('Not yours');
      return row;
    },
  };
  return ctx;
}

// Who may mark a member's gold share: editors, the character's owner, or its pilot
// (the slot's pilot name matches the caller's display name or username).
async function shareTarget(ctx, a) {
  const col = a.record_id ? 'record_id' : 'lineup_id';
  const parentId = a.record_id || a.lineup_id;
  const member = String(a.member_name || '');
  if (!parentId || !member) deny('A lineup or loot record and a member are required');
  const owner = await one('players', `name=eq.${enc(member)}&select=discord_id&limit=1`);
  const ownerId = owner?.discord_id || null;
  if (ctx.isEditor || ownerId === ctx.id) return { col, parentId, ownerId };
  let pilot = '';
  if (a.record_id) {
    const rec = await one('loot_records', `id=eq.${enc(parentId)}&select=pilots`);
    pilot = String((rec?.pilots || {})[member] || '');
  } else {
    const slot = await one('lineup_players', `lineup_id=eq.${enc(parentId)}&player_name=eq.${enc(member)}&select=pilot_name&limit=1`);
    pilot = String(slot?.pilot_name || '');
  }
  pilot = pilot.trim().toLowerCase();
  const me = await one('app_users', `discord_id=eq.${enc(ctx.id)}&select=display_name,username`);
  const mine = [me?.display_name, me?.username].map((n) => String(n || '').trim().toLowerCase());
  if (!pilot || !mine.includes(pilot)) deny('You can only mark your own share received');
  return { col, parentId, ownerId };
}

const ACTIONS = {
  // ---- your own account ----
  async 'user.updateSelf'(ctx, a) {
    const fields = pick(a.fields, ['display_name', 'available_from', 'log_off_time', 'availability_timezone', 'available_anytime']);
    if ('display_name' in fields && !String(fields.display_name || '').trim()) deny('Display name cannot be empty');
    await sbPatch('app_users', `discord_id=eq.${enc(ctx.id)}`, fields);
    return {};
  },

  // ---- admins on other users ----
  async 'admin.updateUser'(ctx, a) {
    ctx.requireAdmin();
    const target = await one('app_users', `discord_id=eq.${enc(a.discord_id)}&select=discord_id,role`);
    if (!target) deny('No such user');
    const fields = pick(a.fields, ['role', 'exclude', 'exclude_label', 'exclude_reason', 'display_name']);
    if ('role' in fields) {
      if (!ROLES.includes(fields.role)) deny('Unknown role');
      if (target.discord_id === ctx.id) deny('You cannot change your own role');
      // Admin follows the Vice Members role on Discord; the bot syncs the rest both ways.
      if (fields.role !== target.role && (fields.role === 'admin' || target.role === 'admin')) deny('Admin is set in Discord (Vice Members)');
    }
    // Another admin can only be changed by the site owner.
    if (target.role === 'admin' && target.discord_id !== ctx.id && ctx.id !== ownerId()) deny('Only the site owner can change another admin');
    await sbPatch('app_users', `discord_id=eq.${enc(a.discord_id)}`, fields);
    return {};
  },

  // ---- characters ----
  async 'player.add'(ctx, a) {
    const fields = pick(a.fields, [...PLAYER_FIELDS, ...PLAYER_GEAR_FIELDS, ...COMPLETION_COLUMNS]);
    if (!String(fields.name || '').trim()) deny('A character needs a name');
    const [row] = await sbPost('players', { ...fields, ...handBuiltFields(a), discord_id: ctx.id });
    return { data: row };
  },
  async 'player.update'(ctx, a) {
    const p = await ctx.player(a.id);
    const fields = p.synced_at ? pick(a.fields, PLAYER_FIELDS)
      : { ...pick(a.fields, [...PLAYER_FIELDS, ...PLAYER_GEAR_FIELDS]), ...handBuiltFields(a, p.overrides) };
    await sbPatch('players', `id=eq.${enc(p.id)}`, fields);
    return {};
  },
  async 'player.delete'(ctx, a) {
    const p = await ctx.player(a.id);
    await sbDelete('players', `id=eq.${enc(p.id)}`);
    return {};
  },
  async 'player.adminFlags'(ctx, a) {
    ctx.requireAdmin();
    const fields = pick(a.fields, ['exclude', 'whitelisted', 'whitelist_ignored', 'discord_id']);
    await sbPatch('players', `id=eq.${enc(a.id)}`, fields);
    return {};
  },
  async 'player.raidCompletion'(ctx, a) {
    if (!COMPLETION_COLUMNS.has(a.column) && !MARK_ONLY_COLUMNS.has(a.column)) deny('Unknown raid');
    const p = await ctx.player(a.id);
    await sbPatch('players', `id=eq.${enc(p.id)}`, { [a.column]: a.completed ? new Date().toISOString() : null });
    return {};
  },
  // Clearing a lineup marks its members, by name.
  async 'players.lineupCompletion'(ctx, a) {
    ctx.requireEditor();
    if (!COMPLETION_COLUMNS.has(a.column)) deny('Unknown raid');
    const value = a.completed ? new Date().toISOString() : null;
    for (const name of [].concat(a.names || [])) await sbPatch('players', `name=eq.${enc(name)}`, { [a.column]: value });
    return {};
  },
  // Ticket runs used this week, set or cleared with the lineup's completion.
  async 'players.ticketUsed'(ctx, a) {
    ctx.requireEditor();
    const names = [].concat(a.names || []).map(String);
    if (!names.length) return {};
    await sbRpc('set_ticket_used', { p_raid: String(a.raid || ''), p_used: !!a.used, p_names: names });
    return {};
  },
  async 'player.setGroup'(ctx, a) {
    const p = await ctx.player(a.id, { ownerOnly: true });
    if (a.group_id) await ctx.own('character_groups', a.group_id);
    await sbPatch('players', `id=eq.${enc(p.id)}`, { group_id: a.group_id || null });
    return {};
  },
  async 'player.saveOrder'(ctx, a) {
    for (const e of [].concat(a.entries || [])) {
      await ctx.player(e.id, { ownerOnly: true });
      if (e.group_id) await ctx.own('character_groups', e.group_id);
      await sbPatch('players', `id=eq.${enc(e.id)}`, { group_id: e.group_id || null, sort_order: Number(e.sort_order) || 0 });
    }
    return {};
  },

  // ---- card collection ----
  async 'cards.set'(ctx, a) {
    const p = await ctx.player(a.player_id);
    const entries = [].concat(a.entries || []);
    const upserts = entries.filter((e) => e.rarity).map((e) => {
      if (!RARITIES.has(e.rarity)) deny('Unknown rarity');
      return { player_id: p.id, slot_index: Number(e.slot_index), rarity: e.rarity };
    });
    if (upserts.length) await sbUpsert('player_cards', upserts, 'player_id,slot_index');
    for (const e of entries.filter((x) => !x.rarity)) {
      await sbDelete('player_cards', `player_id=eq.${enc(p.id)}&slot_index=eq.${Number(e.slot_index)}`);
    }
    return {};
  },
  async 'extras.add'(ctx, a) {
    const p = await ctx.player(a.player_id);
    const amount = Number(a.amount);
    if (!a.card_name || !RARITIES.has(a.rarity) || !Number.isInteger(amount) || amount < 1) deny('Card, rarity and an amount of at least 1 are required');
    const existing = await one('player_extra_cards', `player_id=eq.${enc(p.id)}&card_name=eq.${enc(a.card_name)}&rarity=eq.${enc(a.rarity)}&select=id,amount`);
    if (existing) {
      await sbPatch('player_extra_cards', `id=eq.${enc(existing.id)}`, { amount: existing.amount + amount });
      return { id: existing.id, amount: existing.amount + amount };
    }
    const [row] = await sbPost('player_extra_cards', { player_id: p.id, card_name: a.card_name, rarity: a.rarity, amount });
    return { id: row.id, amount: row.amount };
  },
  async 'extras.setAmount'(ctx, a) {
    const row = await one('player_extra_cards', `id=eq.${enc(a.id)}&select=id,player_id`);
    if (!row) deny('No such card');
    await ctx.player(row.player_id);
    const amount = Number(a.amount);
    if (!(amount > 0)) await sbDelete('player_extra_cards', `id=eq.${enc(row.id)}`);
    else await sbPatch('player_extra_cards', `id=eq.${enc(row.id)}`, { amount: Math.floor(amount) });
    return {};
  },

  // ---- personal raids ----
  async 'raids.add'(ctx, a) {
    const p = await ctx.player(a.player_id, { ownerOnly: true });
    const last = await one('personal_raids', `player_id=eq.${enc(p.id)}&select=sort_order&order=sort_order.desc&limit=1`);
    const [row] = await sbPost('personal_raids', {
      discord_id: ctx.id, player_id: p.id, name: String(a.name || '').trim(),
      max_clears: Math.max(1, Number(a.max_clears) || 1), current_clears: 0, sort_order: (last?.sort_order ?? -1) + 1,
    });
    return { data: row };
  },
  async 'raids.update'(ctx, a) {
    const row = await ctx.own('personal_raids', a.id);
    await sbPatch('personal_raids', `id=eq.${enc(row.id)}`, pick(a.fields, ['name', 'max_clears', 'current_clears', 'sort_order']));
    return {};
  },
  async 'raids.step'(ctx, a) {
    const row = await ctx.own('personal_raids', a.id);
    const next = row.current_clears + (a.delta > 0 ? 1 : -1);
    if (next > row.max_clears) deny('Already at max clears');
    if (next < 0) deny('Already at zero');
    await sbPatch('personal_raids', `id=eq.${enc(row.id)}`, { current_clears: next });
    return { newClears: next };
  },
  async 'raids.delete'(ctx, a) {
    const row = await ctx.own('personal_raids', a.id);
    await sbDelete('personal_raids', `id=eq.${enc(row.id)}`);
    return {};
  },

  // ---- shopping list ----
  async 'shopping.add'(ctx, a) {
    const p = await ctx.player(a.player_id, { ownerOnly: true });
    const last = await one('shopping_list', `player_id=eq.${enc(p.id)}&select=sort_order&order=sort_order.desc&limit=1`);
    const [row] = await sbPost('shopping_list', {
      discord_id: ctx.id, player_id: p.id, item: String(a.item || '').trim(), bought: false,
      price: Number(a.price) || 0, sort_order: (last?.sort_order ?? -1) + 1,
    });
    return { data: row };
  },
  async 'shopping.update'(ctx, a) {
    const row = await ctx.own('shopping_list', a.id);
    const fields = pick(a.fields, ['item', 'bought', 'price', 'sort_order']);
    if ('price' in fields) fields.price = Number(fields.price) || 0;
    await sbPatch('shopping_list', `id=eq.${enc(row.id)}`, fields);
    return {};
  },
  async 'shopping.delete'(ctx, a) {
    const row = await ctx.own('shopping_list', a.id);
    await sbDelete('shopping_list', `id=eq.${enc(row.id)}`);
    return {};
  },

  // ---- character groups ----
  async 'groups.add'(ctx, a) {
    const account = Number(a.account_number) || 1;
    const last = await one('character_groups', `discord_id=eq.${enc(ctx.id)}&account_number=eq.${account}&select=sort_order&order=sort_order.desc&limit=1`);
    const [row] = await sbPost('character_groups', { discord_id: ctx.id, account_number: account, name: String(a.name || '').trim(), sort_order: (last?.sort_order ?? -1) + 1 });
    return { data: row };
  },
  async 'groups.rename'(ctx, a) {
    const row = await ctx.own('character_groups', a.id);
    await sbPatch('character_groups', `id=eq.${enc(row.id)}`, { name: String(a.name || '').trim() });
    return {};
  },
  async 'groups.delete'(ctx, a) {
    const row = await ctx.own('character_groups', a.id);
    await sbDelete('character_groups', `id=eq.${enc(row.id)}`);
    return {};
  },
  async 'groups.reorder'(ctx, a) {
    const ids = [].concat(a.ids || []);
    for (const id of ids) await ctx.own('character_groups', id);
    for (let i = 0; i < ids.length; i++) await sbPatch('character_groups', `id=eq.${enc(ids[i])}`, { sort_order: i });
    return {};
  },

  // ---- lineups (editors and admins) ----
  async 'lineups.save'(ctx, a) {
    ctx.requireEditor();
    const fields = pick(a.fields, ['name', 'raid_type', 'status', 'completed', 'is_template', 'is_static', 'notes', 'raid_time']);
    let saved;
    if (a.id) {
      [saved] = await sbPatch('lineups', `id=eq.${enc(a.id)}`, fields);
      if (!saved) deny('No such lineup');
    } else {
      [saved] = await sbPost('lineups', fields);
    }
    await sbDelete('lineup_players', `lineup_id=eq.${enc(saved.id)}`);
    const slots = [].concat(a.slots || []).filter((s) => s && s.player_name).map((s) => ({
      lineup_id: saved.id,
      player_name: String(s.player_name),
      slot_position: Number(s.slot_position),
      uses_ticket: !!s.uses_ticket,
      pilot_name: s.pilot_name || null,
    }));
    if (slots.length) await sbPost('lineup_players', slots);
    return { data: saved };
  },
  async 'lineups.update'(ctx, a) {
    ctx.requireEditor();
    await sbPatch('lineups', `id=eq.${enc(a.id)}`, pick(a.fields, ['raid_type', 'is_template']));
    return {};
  },
  async 'lineups.delete'(ctx, a) {
    ctx.requireEditor();
    await sbDelete('lineups', `id=eq.${enc(a.id)}`);
    return {};
  },
  // Clear or un-clear a lineup, marking its members (and ticket runs) to match.
  async 'lineups.toggleCompleted'(ctx, a) {
    ctx.requireEditor();
    const lineup = await one('lineups', `id=eq.${enc(a.id)}&select=id,completed,raid_type`);
    if (!lineup) deny('No such lineup');
    const completed = !lineup.completed;
    await sbPatch('lineups', `id=eq.${enc(lineup.id)}`, { completed });
    const column = COMPLETION_BY_RAID[lineup.raid_type];
    if (column) {
      const slots = (await sbGet('lineup_players', `lineup_id=eq.${enc(lineup.id)}&select=player_name,uses_ticket`))
        .filter((s) => (s.player_name || '').trim());
      // Un-clearing leaves ticket runs alone: they may have cleared in another lineup.
      const names = slots.filter((s) => completed || !s.uses_ticket).map((s) => s.player_name);
      const value = completed ? new Date().toISOString() : null;
      for (const name of names) await sbPatch('players', `name=eq.${enc(name)}`, { [column]: value });
      const tickets = slots.filter((s) => s.uses_ticket).map((s) => s.player_name);
      if (completed && tickets.length && / Classic$/.test(lineup.raid_type || '')) {
        await sbRpc('set_ticket_used', { p_raid: lineup.raid_type, p_used: true, p_names: tickets });
      }
    }
    return { completed };
  },

  // ---- loot (editors and admins) ----
  async 'loot.add'(ctx, a) {
    ctx.requireEditor();
    const col = a.record_id ? 'record_id' : 'lineup_id';
    const parentId = a.record_id || a.lineup_id;
    if (!parentId) deny('A lineup or loot record is required');
    const item = String(a.item || '').trim();
    if (!item) deny('Item name cannot be empty');
    const last = await one('lineup_loot', `${col}=eq.${enc(parentId)}&select=sort_order&order=sort_order.desc&limit=1`);
    const [row] = await sbPost('lineup_loot', {
      [col]: parentId, item, sold: false, price: 0, sort_order: (last?.sort_order ?? -1) + 1,
      held_by: String(a.held_by || '').trim() || null, source: 'web', created_by: ctx.id,
    });
    return { data: row };
  },
  async 'loot.update'(ctx, a) {
    ctx.requireEditor();
    const fields = pick(a.fields, ['item', 'sold', 'price', 'held_by', 'sort_order']);
    if ('item' in fields && !String(fields.item || '').trim()) deny('Item name cannot be empty');
    if ('price' in fields) fields.price = Math.max(0, Math.round(Number(fields.price) || 0));
    await sbPatch('lineup_loot', `id=eq.${enc(a.id)}`, fields);
    return {};
  },
  async 'loot.delete'(ctx, a) {
    ctx.requireEditor();
    await sbDelete('lineup_loot', `id=eq.${enc(a.id)}`);
    return {};
  },

  // ---- gold shares: the member's owner or pilot, or an editor ----
  async 'payouts.mark'(ctx, a) {
    const share = await shareTarget(ctx, a);
    const row = {
      [share.col]: share.parentId, member_name: a.member_name, discord_id: share.ownerId,
      source: 'web', created_by: ctx.id, received_at: new Date().toISOString(),
      amount: Math.max(0, Math.round(Number(a.amount) || 0)),
    };
    await sbUpsert('lineup_payouts', row, `${share.col},member_name`);
    return {};
  },
  async 'payouts.unmark'(ctx, a) {
    const share = await shareTarget(ctx, a);
    await sbDelete('lineup_payouts', `${share.col}=eq.${enc(share.parentId)}&member_name=eq.${enc(a.member_name)}`);
    return {};
  },

  // ---- loot records (editors and admins) ----
  async 'records.archive'(ctx, a) {
    ctx.requireEditor();
    const id = await sbRpc('archive_lineup_to_loot_record', { p_lineup_id: a.lineup_id });
    return { id };
  },
  async 'records.delete'(ctx, a) {
    ctx.requireEditor();
    await sbDelete('loot_records', `id=eq.${enc(a.id)}`);
    return {};
  },

  // ---- Discord thread requests for the bot (editors and admins) ----
  async 'threads.request'(ctx, a) {
    ctx.requireEditor();
    if (!['create', 'update', 'clear'].includes(a.kind)) deny('Unknown thread request');
    const [row] = await sbPost('thread_requests', {
      lineup_id: a.lineup_id, channel_id: a.kind === 'create' ? String(a.channel_id || '') : '',
      requested_by: ctx.id, status: 'pending', action: a.kind,
    });
    return { data: row };
  },

  // ---- site settings (admins) ----
  async 'config.set'(ctx, a) {
    ctx.requireAdmin();
    const key = String(a.key || '').trim();
    if (!key) deny('A setting name is required');
    await sbUpsert('app_config', { key, value: a.value }, 'key');
    return {};
  },

  // ---- simulator builds ----
  async 'builds.save'(ctx, a) {
    const row = { discord_id: ctx.id, name: String(a.name || '').trim(), build: a.build || {} };
    if (a.id) {
      await ctx.own('saved_builds', a.id);
      const [updated] = await sbPatch('saved_builds', `id=eq.${enc(a.id)}`, row);
      return { data: updated };
    }
    const [created] = await sbPost('saved_builds', row);
    return { data: created };
  },
  async 'builds.delete'(ctx, a) {
    const row = await ctx.own('saved_builds', a.id);
    await sbDelete('saved_builds', `id=eq.${enc(row.id)}`);
    return {};
  },
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: json(204, {}).headers };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !process.env.SESSION_SECRET) return json(500, { error: 'Server not configured' });
  if ((event.body || '').length > MAX_BODY) return json(413, { error: 'Payload too large' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Bad JSON' }); }
  const discordId = verifySession(body.session, process.env.SESSION_SECRET);
  if (!discordId) return json(401, { error: 'Log in again to save changes' });
  const action = ACTIONS[body.action];
  if (!action) return json(400, { error: 'Unknown action' });

  try {
    const ctx = await context(discordId);
    const need = MIN_ROLE[body.action];
    if (need && rank(ctx.role) < rank(need)) deny(need === 'friend' ? 'Ask an officer for the Part-time Afterlight role first' : 'Guildmates only');
    return json(200, { ok: true, ...(await action(ctx, body)) });
  } catch (e) {
    if (e instanceof Denied) return json(403, { error: e.message });
    console.error(`site-write ${body.action} failed:`, e);
    return json(500, { error: 'Could not save; try again' });
  }
}
