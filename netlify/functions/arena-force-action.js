/**
 * Arena Force Action — Auto-picks a random action for a player who hasn't committed in time.
 * Called by the opponent's client when the action timer expires.
 *
 * Expects: { matchId, roundId, turnId, requestingDiscordId }
 * - requestingDiscordId must have already committed their action
 * - The OTHER player gets a random action auto-committed
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const sbHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

async function sbGet(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders });
  const data = await res.json();
  if (!res.ok) throw new Error(`DB read failed: ${data.message || JSON.stringify(data)}`);
  return data;
}

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  try {
    const { matchId, roundId, turnId, requestingDiscordId } = JSON.parse(event.body || '{}');

    if (!matchId || !roundId || !turnId || !requestingDiscordId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    // Get match
    const matches = await sbGet('arena_matches', `id=eq.${matchId}&select=*`);
    const match = matches[0];
    if (!match) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Match not found' }) };
    }

    // Get participants
    const participants = await sbGet('arena_participants', `id=in.(${match.player1_id},${match.player2_id})&select=*`);
    const p1 = participants.find(p => p.id === match.player1_id);
    const p2 = participants.find(p => p.id === match.player2_id);

    // Determine sides
    let requesterSide, absentSide;
    if (p1?.discord_id === requestingDiscordId) {
      requesterSide = 'player1';
      absentSide = 'player2';
    } else if (p2?.discord_id === requestingDiscordId) {
      requesterSide = 'player2';
      absentSide = 'player1';
    } else {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Not a player in this match' }) };
    }

    // Get current turn
    const turns = await sbGet('arena_turns', `id=eq.${turnId}&select=*`);
    const turn = turns[0];
    if (!turn) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Turn not found' }) };
    }

    // Verify requester has already committed
    if (!turn[`${requesterSide}_committed`]) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'You must commit your action first' }) };
    }

    // Verify opponent hasn't committed
    if (turn[`${absentSide}_committed`]) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, alreadyResolved: true }) };
    }

    // Pick a random action for the absent player
    const actions = ['attack', 'defend', 'strong_attack'];
    const randomAction = actions[Math.floor(Math.random() * actions.length)];

    // Submit the action via the arena-action function logic by calling it internally
    // We'll use the absent player's discord_id to submit on their behalf
    const absentDiscordId = absentSide === 'player1' ? p1.discord_id : p2.discord_id;

    // Call the arena-action function endpoint
    const actionRes = await fetch(`${SUPABASE_URL.replace('/rest/v1', '').replace('https://', 'https://')}/../.netlify/functions/arena-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchId,
        roundId,
        turnId,
        discordId: absentDiscordId,
        action: randomAction,
        useAbility: false
      })
    }).catch(() => null);

    // If we can't call the function directly, do it via Supabase directly
    // (the arena-action function is on the same Netlify instance, so calling it may not work server-to-server)
    // Instead, just commit the action directly to the DB and let the arena-action resolution logic handle it
    // by patching the turn directly

    const patchHeaders = { ...sbHeaders };
    const patchBody = {
      [`${absentSide}_action`]: randomAction,
      [`${absentSide}_ability`]: false,
      [`${absentSide}_committed`]: true
    };

    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/arena_turns?id=eq.${turnId}&${absentSide}_committed=eq.false`, {
      method: 'PATCH',
      headers: { ...sbHeaders, 'Prefer': 'return=representation' },
      body: JSON.stringify(patchBody)
    });
    const patchData = await patchRes.json();

    if (!patchRes.ok) {
      // Maybe already committed
      if (patchData.length === 0 || patchRes.status === 409) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, alreadyResolved: true }) };
      }
      throw new Error(`DB update failed: ${patchData.message || JSON.stringify(patchData)}`);
    }

    // Now both are committed — we need to trigger resolution
    // Re-read the turn to confirm both committed
    const updatedTurns = await sbGet('arena_turns', `id=eq.${turnId}&select=*`);
    const updatedTurn = updatedTurns[0];

    if (!updatedTurn.player1_committed || !updatedTurn.player2_committed) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, resolved: false }) };
    }

    // Both committed — trigger resolution by calling arena-action's resolution logic
    // Since we can't easily call another Netlify function server-to-server,
    // we replicate the resolution here. But to avoid code duplication,
    // the simplest approach is: the requester's client will detect the turn update
    // via Realtime subscription and the existing arena-action resolution will kick in
    // when the Realtime callback processes the turn.
    //
    // Actually, the problem is that resolution only happens inside arena-action when
    // the second player commits. Since we just committed directly to DB (bypassing
    // arena-action), we need to trigger resolution ourselves.
    //
    // The cleanest approach: have the client call arena-action on behalf of the absent
    // player. But the client doesn't have the absent player's discord_id.
    //
    // Better approach: this function commits the action AND resolves the turn,
    // using the same logic as arena-action.

    // Check if already resolved
    if (updatedTurn.resolved) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, alreadyResolved: true }) };
    }

    // Claim resolution atomically
    const claimRes = await fetch(`${SUPABASE_URL}/rest/v1/arena_turns?id=eq.${turnId}&resolved=eq.false`, {
      method: 'PATCH',
      headers: { ...sbHeaders, 'Prefer': 'return=headers-only' },
      body: JSON.stringify({ resolved: true })
    });
    const contentRange = claimRes.headers.get('content-range') || '';
    const rangeParts = contentRange.split('/')[0]?.split('-') || [];
    const affectedRows = rangeParts.length >= 2 ? parseInt(rangeParts[1], 10) + 1 : 0;
    if (!claimRes.ok || affectedRows === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, alreadyResolved: true }) };
    }

    // ═══════════════════════════════════════════════
    // RESOLVE TURN (same logic as arena-action.js)
    // ═══════════════════════════════════════════════

    const rounds = await sbGet('arena_rounds', `id=eq.${roundId}&select=*`);
    const round = rounds[0];

    let p1Action = updatedTurn.player1_action;
    let p2Action = updatedTurn.player2_action;
    let p1Hp = round.player1_hp;
    let p2Hp = round.player2_hp;
    let p1Status = round.player1_status || {};
    let p2Status = round.player2_status || {};
    let p1AbilityUsed = round.player1_ability_used;
    let p2AbilityUsed = round.player2_ability_used;

    const events = [];
    const DAMAGE = { ATTACK: 12, STRONG_ATTACK: 16, DEFEND_COUNTER: 8 };
    const MAX_HP = 120;

    function getClassFamily(className) {
      const families = {
        warrior: ['Gladiator', 'Moon Lord', 'Barbarian', 'Destroyer'],
        archer: ['Sniper', 'Artillery', 'Tempest', 'Wind Walker'],
        sorceress: ['Saleana', 'Elestra', 'Smasher', 'Majesty'],
        cleric: ['Saint', 'Inquisitor', 'Guardian', 'Crusader'],
        academic: ['Gear Master', 'Shooting Star', 'Adept', 'Physician'],
        kali: ['Dark Summoner', 'Soul Eater', 'Blade Dancer', 'Spirit Dancer']
      };
      for (const [family, classes] of Object.entries(families)) {
        if (classes.includes(className)) return family;
      }
      return null;
    }

    function resolveRPS(action1, action2) {
      if (action1 === action2) {
        if (action1 === 'defend') return { winner: 0, damage: 0 };
        const dmg = action1 === 'attack' ? DAMAGE.ATTACK : DAMAGE.STRONG_ATTACK;
        return { winner: 0, damage: Math.floor(dmg / 2) };
      }
      const beats = { attack: 'strong_attack', defend: 'attack', strong_attack: 'defend' };
      if (beats[action1] === action2) {
        const dmg = action1 === 'attack' ? DAMAGE.ATTACK : action1 === 'defend' ? DAMAGE.DEFEND_COUNTER : DAMAGE.STRONG_ATTACK;
        return { winner: 1, damage: dmg };
      } else {
        const dmg = action2 === 'attack' ? DAMAGE.ATTACK : action2 === 'defend' ? DAMAGE.DEFEND_COUNTER : DAMAGE.STRONG_ATTACK;
        return { winner: 2, damage: dmg };
      }
    }

    // Ability processing
    let p1ChargedJustActivated = false;
    let p2ChargedJustActivated = false;

    // Sorceress: Charged Missile
    if (updatedTurn.player1_ability && !p1AbilityUsed) {
      if (getClassFamily(round.player1_character?.className) === 'sorceress') {
        p1Action = 'defend';
        p1Status.chargedMissile = { active: true };
        p1AbilityUsed = true;
        p1ChargedJustActivated = true;
        events.push({ type: 'ability_activate', player: round.player1_character?.playerName, abilityName: 'Charged Missile' });
      }
    }
    if (updatedTurn.player2_ability && !p2AbilityUsed) {
      if (getClassFamily(round.player2_character?.className) === 'sorceress') {
        p2Action = 'defend';
        p2Status.chargedMissile = { active: true };
        p2AbilityUsed = true;
        p2ChargedJustActivated = true;
        events.push({ type: 'ability_activate', player: round.player2_character?.playerName, abilityName: 'Charged Missile' });
      }
    }

    // Cleric: Heal
    if (updatedTurn.player1_ability && !p1AbilityUsed) {
      if (getClassFamily(round.player1_character?.className) === 'cleric') {
        const healed = Math.min(20, MAX_HP - p1Hp);
        p1Hp += healed;
        p1AbilityUsed = true;
        events.push({ type: 'ability_activate', player: round.player1_character?.playerName, abilityName: 'Heal' });
        events.push({ type: 'heal', player: round.player1_character?.playerName, amount: healed });
      }
    }
    if (updatedTurn.player2_ability && !p2AbilityUsed) {
      if (getClassFamily(round.player2_character?.className) === 'cleric') {
        const healed = Math.min(20, MAX_HP - p2Hp);
        p2Hp += healed;
        p2AbilityUsed = true;
        events.push({ type: 'ability_activate', player: round.player2_character?.playerName, abilityName: 'Heal' });
        events.push({ type: 'heal', player: round.player2_character?.playerName, amount: healed });
      }
    }

    // Warrior: Highlander
    if (updatedTurn.player1_ability && !p1AbilityUsed) {
      if (getClassFamily(round.player1_character?.className) === 'warrior') {
        p1Status.highlander = { turnsLeft: 2, triggered: false };
        p1AbilityUsed = true;
        events.push({ type: 'ability_activate', player: round.player1_character?.playerName, abilityName: 'Highlander' });
      }
    }
    if (updatedTurn.player2_ability && !p2AbilityUsed) {
      if (getClassFamily(round.player2_character?.className) === 'warrior') {
        p2Status.highlander = { turnsLeft: 2, triggered: false };
        p2AbilityUsed = true;
        events.push({ type: 'ability_activate', player: round.player2_character?.playerName, abilityName: 'Highlander' });
      }
    }

    // Academic: Food Dispenser
    let p1FoodBonus = { dmgBoost: 0, dmgReduce: 0, hpRestore: 0 };
    let p2FoodBonus = { dmgBoost: 0, dmgReduce: 0, hpRestore: 0 };

    if (updatedTurn.player1_ability && !p1AbilityUsed) {
      if (getClassFamily(round.player1_character?.className) === 'academic') {
        const roll = Math.floor(Math.random() * 3);
        if (roll === 0) { p1FoodBonus.dmgBoost = 5; events.push({ type: 'food_dispenser_result', label: '+5 damage' }); }
        else if (roll === 1) { p1FoodBonus.dmgReduce = 5; events.push({ type: 'food_dispenser_result', label: '-5 incoming' }); }
        else { p1FoodBonus.hpRestore = 10; events.push({ type: 'food_dispenser_result', label: '+10 HP' }); }
        p1AbilityUsed = true;
        events.push({ type: 'ability_activate', player: round.player1_character?.playerName, abilityName: 'Food Dispenser' });
      }
    }
    if (updatedTurn.player2_ability && !p2AbilityUsed) {
      if (getClassFamily(round.player2_character?.className) === 'academic') {
        const roll = Math.floor(Math.random() * 3);
        if (roll === 0) { p2FoodBonus.dmgBoost = 5; events.push({ type: 'food_dispenser_result', label: '+5 damage' }); }
        else if (roll === 1) { p2FoodBonus.dmgReduce = 5; events.push({ type: 'food_dispenser_result', label: '-5 incoming' }); }
        else { p2FoodBonus.hpRestore = 10; events.push({ type: 'food_dispenser_result', label: '+10 HP' }); }
        p2AbilityUsed = true;
        events.push({ type: 'ability_activate', player: round.player2_character?.playerName, abilityName: 'Food Dispenser' });
      }
    }

    if (p1FoodBonus.hpRestore > 0) p1Hp = Math.min(MAX_HP, p1Hp + p1FoodBonus.hpRestore);
    if (p2FoodBonus.hpRestore > 0) p2Hp = Math.min(MAX_HP, p2Hp + p2FoodBonus.hpRestore);

    // Archer: Critical Buff & Kali: Ghost Guard
    let p1DmgMultiplier = 1;
    let p2DmgMultiplier = 1;

    if (updatedTurn.player1_ability && !p1AbilityUsed) {
      const cls = getClassFamily(round.player1_character?.className);
      if (cls === 'archer') { p1DmgMultiplier = 1.5; p1AbilityUsed = true; events.push({ type: 'ability_activate', player: round.player1_character?.playerName, abilityName: 'Critical Buff' }); }
      else if (cls === 'kali') { p2DmgMultiplier *= 0.5; p1AbilityUsed = true; events.push({ type: 'ability_activate', player: round.player1_character?.playerName, abilityName: 'Ghost Guard' }); }
    }
    if (updatedTurn.player2_ability && !p2AbilityUsed) {
      const cls = getClassFamily(round.player2_character?.className);
      if (cls === 'archer') { p2DmgMultiplier = 1.5; p2AbilityUsed = true; events.push({ type: 'ability_activate', player: round.player2_character?.playerName, abilityName: 'Critical Buff' }); }
      else if (cls === 'kali') { p1DmgMultiplier *= 0.5; p2AbilityUsed = true; events.push({ type: 'ability_activate', player: round.player2_character?.playerName, abilityName: 'Ghost Guard' }); }
    }

    // Charged Missile from previous turn
    if (p1Status.chargedMissile?.active && !p1ChargedJustActivated) {
      p1DmgMultiplier *= 2;
      delete p1Status.chargedMissile;
      events.push({ type: 'ability_activate', player: round.player1_character?.playerName, abilityName: 'Charged Missile (charged attack!)' });
    }
    if (p2Status.chargedMissile?.active && !p2ChargedJustActivated) {
      p2DmgMultiplier *= 2;
      delete p2Status.chargedMissile;
      events.push({ type: 'ability_activate', player: round.player2_character?.playerName, abilityName: 'Charged Missile (charged attack!)' });
    }

    // Resolve RPS
    events.push({ type: 'action_reveal', player: round.player1_character?.playerName || 'P1', action: p1Action });
    events.push({ type: 'action_reveal', player: round.player2_character?.playerName || 'P2', action: p2Action });

    const rps = resolveRPS(p1Action, p2Action);
    let p1DamageDealt = 0;
    let p2DamageDealt = 0;
    const p1Name = round.player1_character?.playerName || 'P1';
    const p2Name = round.player2_character?.playerName || 'P2';

    if (rps.winner === 0 && rps.damage > 0) {
      p1DamageDealt = Math.floor((rps.damage + p1FoodBonus.dmgBoost) * p1DmgMultiplier);
      p1DamageDealt = Math.max(0, p1DamageDealt - p2FoodBonus.dmgReduce);
      p2DamageDealt = Math.floor((rps.damage + p2FoodBonus.dmgBoost) * p2DmgMultiplier);
      p2DamageDealt = Math.max(0, p2DamageDealt - p1FoodBonus.dmgReduce);
      events.push({ type: 'clash', message: 'Both used the same action — mutual damage!' });
      events.push({ type: 'damage_received', player: p2Name, amount: p1DamageDealt });
      events.push({ type: 'damage_received', player: p1Name, amount: p2DamageDealt });
      p2Hp -= p1DamageDealt;
      p1Hp -= p2DamageDealt;
    } else if (rps.winner === 1) {
      p1DamageDealt = Math.floor((rps.damage + p1FoodBonus.dmgBoost) * p1DmgMultiplier);
      p1DamageDealt = Math.max(0, p1DamageDealt - p2FoodBonus.dmgReduce);
      events.push({ type: 'rps_win', winner: p1Name, loser: p2Name, winAction: p1Action, loseAction: p2Action });
      events.push({ type: 'damage_received', player: p2Name, amount: p1DamageDealt });
      p2Hp -= p1DamageDealt;
    } else if (rps.winner === 2) {
      p2DamageDealt = Math.floor((rps.damage + p2FoodBonus.dmgBoost) * p2DmgMultiplier);
      p2DamageDealt = Math.max(0, p2DamageDealt - p1FoodBonus.dmgReduce);
      events.push({ type: 'rps_win', winner: p2Name, loser: p1Name, winAction: p2Action, loseAction: p1Action });
      events.push({ type: 'damage_received', player: p1Name, amount: p2DamageDealt });
      p1Hp -= p2DamageDealt;
    } else {
      events.push({ type: 'clash', message: 'Both defended — no damage!' });
    }

    // Highlander check
    if (p1Hp <= 0 && p1Status.highlander && !p1Status.highlander.triggered) {
      p1Hp = 1;
      p1Status.highlander.triggered = true;
      events.push({ type: 'highlander_trigger', player: round.player1_character?.playerName });
    }
    if (p2Hp <= 0 && p2Status.highlander && !p2Status.highlander.triggered) {
      p2Hp = 1;
      p2Status.highlander.triggered = true;
      events.push({ type: 'highlander_trigger', player: round.player2_character?.playerName });
    }

    // Tick Highlander duration
    if (p1Status.highlander) {
      p1Status.highlander.turnsLeft--;
      if (p1Status.highlander.turnsLeft <= 0) delete p1Status.highlander;
    }
    if (p2Status.highlander) {
      p2Status.highlander.turnsLeft--;
      if (p2Status.highlander.turnsLeft <= 0) delete p2Status.highlander;
    }

    // Clamp HP
    p1Hp = Math.max(0, Math.min(MAX_HP, p1Hp));
    p2Hp = Math.max(0, Math.min(MAX_HP, p2Hp));

    // Write resolved turn
    const sbPatch = async (table, query, body) => {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
        method: 'PATCH',
        headers: sbHeaders,
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`DB update failed: ${data.message || JSON.stringify(data)}`);
      return data;
    };

    const sbPost = async (table, body, { ignoreDuplicate = false } = {}) => {
      const postHeaders = { ...sbHeaders };
      if (ignoreDuplicate) postHeaders['Prefer'] = 'return=representation,resolution=ignore-duplicates';
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers: postHeaders,
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok && !(ignoreDuplicate && res.status === 409)) {
        throw new Error(`DB insert failed: ${data.message || JSON.stringify(data)}`);
      }
      return data;
    };

    await sbPatch('arena_turns', `id=eq.${turnId}`, {
      player1_action: p1Action,
      player2_action: p2Action,
      player1_damage_dealt: p1DamageDealt,
      player2_damage_dealt: p2DamageDealt,
      player1_hp_after: p1Hp,
      player2_hp_after: p2Hp,
      resolution_log: { events }
    });

    await sbPatch('arena_rounds', `id=eq.${roundId}`, {
      player1_hp: p1Hp,
      player2_hp: p2Hp,
      player1_status: p1Status,
      player2_status: p2Status,
      player1_ability_used: p1AbilityUsed,
      player2_ability_used: p2AbilityUsed
    });

    // Check for KO
    const p1Ko = p1Hp <= 0;
    const p2Ko = p2Hp <= 0;
    const doubleKo = p1Ko && p2Ko;

    let roundWinnerId = null;
    if (doubleKo) {
      events.push({ type: 'ko', player: round.player1_character?.playerName });
      events.push({ type: 'ko', player: round.player2_character?.playerName });
    } else if (p1Ko) {
      roundWinnerId = match.player2_id;
      events.push({ type: 'ko', player: round.player1_character?.playerName });
    } else if (p2Ko) {
      roundWinnerId = match.player1_id;
      events.push({ type: 'ko', player: round.player2_character?.playerName });
    }

    const FORMAT_RULES = { 1: { roundsToWin: 1 }, 2: { roundsToWin: 2 }, 3: { roundsToWin: 2 } };
    const roundsToWin = (FORMAT_RULES[match.match_format] || FORMAT_RULES[1]).roundsToWin;
    const maxRounds = match.match_format || 1;

    if (doubleKo) {
      await sbPatch('arena_rounds', `id=eq.${roundId}`, { winner_id: null });
      const p1Rounds = match.player1_rounds_won;
      const p2Rounds = match.player2_rounds_won;
      const totalDecided = p1Rounds + p2Rounds + 1;

      if (totalDecided >= maxRounds && p1Rounds === p2Rounds) {
        await sbPost('arena_tiebreakers', {
          match_id: matchId, player1_level: 9, player2_level: 9, player1_taps: [], player2_taps: []
        }, { ignoreDuplicate: true });
        await sbPatch('arena_matches', `id=eq.${matchId}`, { status: 'tiebreaker' });
      } else {
        await sbPost('arena_rounds', {
          match_id: matchId, round_number: round.round_number + 1, player1_hp: 120, player2_hp: 120
        }, { ignoreDuplicate: true });
      }
    } else if (roundWinnerId) {
      await sbPatch('arena_rounds', `id=eq.${roundId}`, { winner_id: roundWinnerId });

      const isP1Winner = roundWinnerId === match.player1_id;
      const newP1Rounds = match.player1_rounds_won + (isP1Winner ? 1 : 0);
      const newP2Rounds = match.player2_rounds_won + (isP1Winner ? 0 : 1);

      let matchUpdate = { player1_rounds_won: newP1Rounds, player2_rounds_won: newP2Rounds };

      if (newP1Rounds >= roundsToWin) {
        matchUpdate.status = 'complete';
        matchUpdate.winner_id = match.player1_id;
        await incrementStat(match.player1_id, 'wins');
        await incrementStat(match.player2_id, 'losses');
      } else if (newP2Rounds >= roundsToWin) {
        matchUpdate.status = 'complete';
        matchUpdate.winner_id = match.player2_id;
        await incrementStat(match.player2_id, 'wins');
        await incrementStat(match.player1_id, 'losses');
      } else {
        const totalDecided = newP1Rounds + newP2Rounds;
        const roundsLeft = maxRounds - totalDecided;
        const p1CanWin = newP1Rounds + roundsLeft >= roundsToWin;
        const p2CanWin = newP2Rounds + roundsLeft >= roundsToWin;
        if (!p1CanWin && !p2CanWin && newP1Rounds === newP2Rounds) {
          matchUpdate.status = 'tiebreaker';
          await sbPost('arena_tiebreakers', {
            match_id: matchId, player1_level: 9, player2_level: 9, player1_taps: [], player2_taps: []
          });
        } else {
          await sbPost('arena_rounds', {
            match_id: matchId, round_number: round.round_number + 1, player1_hp: 120, player2_hp: 120
          });
        }
      }

      await sbPatch('arena_matches', `id=eq.${matchId}`, matchUpdate);
    } else {
      // No KO — create next turn
      await sbPost('arena_turns', {
        round_id: roundId,
        turn_number: updatedTurn.turn_number + 1,
        player1_committed: false,
        player2_committed: false,
        resolved: false
      }, { ignoreDuplicate: true });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, resolved: true, forcedAction: randomAction, p1Hp, p2Hp, events })
    };
  } catch (err) {
    console.error('Arena force-action error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
}

async function incrementStat(participantId, field) {
  const rows = await sbGet('arena_participants', `id=eq.${participantId}&select=${field}`);
  const current = rows[0]?.[field] || 0;
  await fetch(`${SUPABASE_URL}/rest/v1/arena_participants?id=eq.${participantId}`, {
    method: 'PATCH',
    headers: sbHeaders,
    body: JSON.stringify({ [field]: current + 1 })
  });
}
