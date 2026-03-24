/**
 * Arena Action — THE critical combat resolution function.
 *
 * Receives player's action + ability flag. Writes committed flag.
 * When both committed: resolves damage, applies abilities, writes HP, checks KO.
 *
 * RPS: Attack > Strong Attack > Defend > Attack
 * Winner deals damage, loser takes it. Draw = 0 damage.
 *
 * Concurrency safety: only resolves when both committed.
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
  return res.json();
}

async function sbPatch(table, query, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: sbHeaders,
    body: JSON.stringify(body)
  });
  return res.json();
}

async function sbPost(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: sbHeaders,
    body: JSON.stringify(body)
  });
  return res.json();
}

// Damage values
const DAMAGE = { ATTACK: 12, STRONG_ATTACK: 16, DEFEND_COUNTER: 8 };
const MAX_HP = 120;

function resolveRPS(action1, action2) {
  if (action1 === action2) return { winner: 0, damage: 0 };

  const beats = {
    attack: 'strong_attack',
    defend: 'attack',
    strong_attack: 'defend'
  };

  if (beats[action1] === action2) {
    const dmg = action1 === 'attack' ? DAMAGE.ATTACK
      : action1 === 'defend' ? DAMAGE.DEFEND_COUNTER
      : DAMAGE.STRONG_ATTACK;
    return { winner: 1, damage: dmg };
  } else {
    const dmg = action2 === 'attack' ? DAMAGE.ATTACK
      : action2 === 'defend' ? DAMAGE.DEFEND_COUNTER
      : DAMAGE.STRONG_ATTACK;
    return { winner: 2, damage: dmg };
  }
}

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
    const { matchId, roundId, turnId, discordId, action, useAbility } = JSON.parse(event.body || '{}');

    if (!matchId || !roundId || !turnId || !discordId || !action) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    const validActions = ['attack', 'defend', 'strong_attack'];
    if (!validActions.includes(action)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) };
    }

    // Get match
    const matches = await sbGet('arena_matches', `id=eq.${matchId}&select=*`);
    const match = matches[0];
    if (!match) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Match not found' }) };
    }

    // Determine player side
    const participants = await sbGet('arena_participants', `id=in.(${match.player1_id},${match.player2_id})&select=*`);
    const p1 = participants.find(p => p.id === match.player1_id);
    const p2 = participants.find(p => p.id === match.player2_id);

    let playerSide;
    if (p1?.discord_id === discordId) playerSide = 'player1';
    else if (p2?.discord_id === discordId) playerSide = 'player2';
    else {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Not a player' }) };
    }

    // Commit action
    const committedField = `${playerSide}_committed`;
    const actionField = `${playerSide}_action`;
    const abilityField = `${playerSide}_ability`;

    // Write our action (only if not already committed)
    const turns = await sbGet('arena_turns', `id=eq.${turnId}&select=*`);
    const currentTurn = turns[0];
    if (!currentTurn) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Turn not found' }) };
    }
    if (currentTurn[committedField]) {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'Action already committed' }) };
    }

    await sbPatch('arena_turns', `id=eq.${turnId}`, {
      [actionField]: action,
      [abilityField]: !!useAbility,
      [committedField]: true
    });

    // Re-fetch to check if both committed
    const updatedTurns = await sbGet('arena_turns', `id=eq.${turnId}&select=*`);
    const turn = updatedTurns[0];

    if (!turn.player1_committed || !turn.player2_committed) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, resolved: false }) };
    }

    // ═══════════════════════════════════════════════
    // BOTH COMMITTED — RESOLVE TURN
    // ═══════════════════════════════════════════════

    const rounds = await sbGet('arena_rounds', `id=eq.${roundId}&select=*`);
    const round = rounds[0];

    let p1Action = turn.player1_action;
    let p2Action = turn.player2_action;
    let p1Hp = round.player1_hp;
    let p2Hp = round.player2_hp;
    let p1Status = round.player1_status || {};
    let p2Status = round.player2_status || {};
    let p1AbilityUsed = round.player1_ability_used;
    let p2AbilityUsed = round.player2_ability_used;

    const events = [];

    // --- Sorceress: Charged Missile — locked into Defend this turn, 2x NEXT turn ---
    let p1ChargedJustActivated = false;
    let p2ChargedJustActivated = false;

    if (turn.player1_ability && !p1AbilityUsed) {
      const p1Class = getClassFamily(round.player1_character?.className);
      if (p1Class === 'sorceress') {
        p1Action = 'defend';
        p1Status.chargedMissile = { active: true };
        p1AbilityUsed = true;
        p1ChargedJustActivated = true;
        events.push({ type: 'ability_activate', player: round.player1_character?.playerName, abilityName: 'Charged Missile' });
      }
    }
    if (turn.player2_ability && !p2AbilityUsed) {
      const p2Class = getClassFamily(round.player2_character?.className);
      if (p2Class === 'sorceress') {
        p2Action = 'defend';
        p2Status.chargedMissile = { active: true };
        p2AbilityUsed = true;
        p2ChargedJustActivated = true;
        events.push({ type: 'ability_activate', player: round.player2_character?.playerName, abilityName: 'Charged Missile' });
      }
    }

    // --- Cleric: Heal — +20 HP before damage ---
    if (turn.player1_ability && !p1AbilityUsed) {
      if (getClassFamily(round.player1_character?.className) === 'cleric') {
        const healed = Math.min(20, MAX_HP - p1Hp);
        p1Hp += healed;
        p1AbilityUsed = true;
        events.push({ type: 'ability_activate', player: round.player1_character?.playerName, abilityName: 'Heal' });
        events.push({ type: 'heal', player: round.player1_character?.playerName, amount: healed });
      }
    }
    if (turn.player2_ability && !p2AbilityUsed) {
      if (getClassFamily(round.player2_character?.className) === 'cleric') {
        const healed = Math.min(20, MAX_HP - p2Hp);
        p2Hp += healed;
        p2AbilityUsed = true;
        events.push({ type: 'ability_activate', player: round.player2_character?.playerName, abilityName: 'Heal' });
        events.push({ type: 'heal', player: round.player2_character?.playerName, amount: healed });
      }
    }

    // --- Warrior: Highlander activation ---
    if (turn.player1_ability && !p1AbilityUsed) {
      if (getClassFamily(round.player1_character?.className) === 'warrior') {
        p1Status.highlander = { turnsLeft: 2, triggered: false };
        p1AbilityUsed = true;
        events.push({ type: 'ability_activate', player: round.player1_character?.playerName, abilityName: 'Highlander' });
      }
    }
    if (turn.player2_ability && !p2AbilityUsed) {
      if (getClassFamily(round.player2_character?.className) === 'warrior') {
        p2Status.highlander = { turnsLeft: 2, triggered: false };
        p2AbilityUsed = true;
        events.push({ type: 'ability_activate', player: round.player2_character?.playerName, abilityName: 'Highlander' });
      }
    }

    // --- Academic: Food Dispenser — RNG ---
    let p1FoodBonus = { dmgBoost: 0, dmgReduce: 0, hpRestore: 0 };
    let p2FoodBonus = { dmgBoost: 0, dmgReduce: 0, hpRestore: 0 };

    if (turn.player1_ability && !p1AbilityUsed) {
      if (getClassFamily(round.player1_character?.className) === 'academic') {
        const roll = Math.floor(Math.random() * 3);
        if (roll === 0) { p1FoodBonus.dmgBoost = 5; events.push({ type: 'food_dispenser_result', label: '+5 damage' }); }
        else if (roll === 1) { p1FoodBonus.dmgReduce = 5; events.push({ type: 'food_dispenser_result', label: '-5 incoming' }); }
        else { p1FoodBonus.hpRestore = 10; events.push({ type: 'food_dispenser_result', label: '+10 HP' }); }
        p1AbilityUsed = true;
        events.push({ type: 'ability_activate', player: round.player1_character?.playerName, abilityName: 'Food Dispenser' });
      }
    }
    if (turn.player2_ability && !p2AbilityUsed) {
      if (getClassFamily(round.player2_character?.className) === 'academic') {
        const roll = Math.floor(Math.random() * 3);
        if (roll === 0) { p2FoodBonus.dmgBoost = 5; events.push({ type: 'food_dispenser_result', label: '+5 damage' }); }
        else if (roll === 1) { p2FoodBonus.dmgReduce = 5; events.push({ type: 'food_dispenser_result', label: '-5 incoming' }); }
        else { p2FoodBonus.hpRestore = 10; events.push({ type: 'food_dispenser_result', label: '+10 HP' }); }
        p2AbilityUsed = true;
        events.push({ type: 'ability_activate', player: round.player2_character?.playerName, abilityName: 'Food Dispenser' });
      }
    }

    // Apply food HP restore
    if (p1FoodBonus.hpRestore > 0) p1Hp = Math.min(MAX_HP, p1Hp + p1FoodBonus.hpRestore);
    if (p2FoodBonus.hpRestore > 0) p2Hp = Math.min(MAX_HP, p2Hp + p2FoodBonus.hpRestore);

    // --- Archer: Critical Buff & Kali: Ghost Guard ---
    let p1DmgMultiplier = 1;
    let p2DmgMultiplier = 1;

    if (turn.player1_ability && !p1AbilityUsed) {
      const cls = getClassFamily(round.player1_character?.className);
      if (cls === 'archer') {
        p1DmgMultiplier = 1.5;
        p1AbilityUsed = true;
        events.push({ type: 'ability_activate', player: round.player1_character?.playerName, abilityName: 'Critical Buff' });
      } else if (cls === 'kali') {
        p2DmgMultiplier *= 0.5;
        p1AbilityUsed = true;
        events.push({ type: 'ability_activate', player: round.player1_character?.playerName, abilityName: 'Ghost Guard' });
      }
    }
    if (turn.player2_ability && !p2AbilityUsed) {
      const cls = getClassFamily(round.player2_character?.className);
      if (cls === 'archer') {
        p2DmgMultiplier = 1.5;
        p2AbilityUsed = true;
        events.push({ type: 'ability_activate', player: round.player2_character?.playerName, abilityName: 'Critical Buff' });
      } else if (cls === 'kali') {
        p1DmgMultiplier *= 0.5;
        p2AbilityUsed = true;
        events.push({ type: 'ability_activate', player: round.player2_character?.playerName, abilityName: 'Ghost Guard' });
      }
    }

    // Charged Missile from PREVIOUS turn — 2x damage (skip if just activated this turn)
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

    // --- Resolve RPS ---
    events.push({ type: 'action_reveal', player: round.player1_character?.playerName || 'P1', action: p1Action });
    events.push({ type: 'action_reveal', player: round.player2_character?.playerName || 'P2', action: p2Action });

    const rps = resolveRPS(p1Action, p2Action);
    let p1DamageDealt = 0;
    let p2DamageDealt = 0;

    if (rps.winner === 1) {
      p1DamageDealt = Math.floor((rps.damage + p1FoodBonus.dmgBoost) * p1DmgMultiplier);
      p1DamageDealt = Math.max(0, p1DamageDealt - p2FoodBonus.dmgReduce);
      events.push({ type: 'damage_dealt', player: round.player1_character?.playerName, amount: p1DamageDealt });
      p2Hp -= p1DamageDealt;
    } else if (rps.winner === 2) {
      p2DamageDealt = Math.floor((rps.damage + p2FoodBonus.dmgBoost) * p2DmgMultiplier);
      p2DamageDealt = Math.max(0, p2DamageDealt - p1FoodBonus.dmgReduce);
      events.push({ type: 'damage_dealt', player: round.player2_character?.playerName, amount: p2DamageDealt });
      p1Hp -= p2DamageDealt;
    }

    // --- Highlander check ---
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

    // --- Write resolved turn ---
    await sbPatch('arena_turns', `id=eq.${turnId}`, {
      player1_damage_dealt: p1DamageDealt,
      player2_damage_dealt: p2DamageDealt,
      player1_hp_after: p1Hp,
      player2_hp_after: p2Hp,
      resolved: true,
      resolution_log: { events }
    });

    // --- Update round ---
    await sbPatch('arena_rounds', `id=eq.${roundId}`, {
      player1_hp: p1Hp,
      player2_hp: p2Hp,
      player1_status: p1Status,
      player2_status: p2Status,
      player1_ability_used: p1AbilityUsed,
      player2_ability_used: p2AbilityUsed
    });

    // --- Check for KO ---
    let roundWinnerId = null;
    if (p1Hp <= 0) {
      roundWinnerId = match.player2_id;
      events.push({ type: 'ko', player: round.player1_character?.playerName });
    } else if (p2Hp <= 0) {
      roundWinnerId = match.player1_id;
      events.push({ type: 'ko', player: round.player2_character?.playerName });
    }

    if (roundWinnerId) {
      await sbPatch('arena_rounds', `id=eq.${roundId}`, { winner_id: roundWinnerId });

      const isP1Winner = roundWinnerId === match.player1_id;
      const newP1Rounds = match.player1_rounds_won + (isP1Winner ? 1 : 0);
      const newP2Rounds = match.player2_rounds_won + (isP1Winner ? 0 : 1);

      let matchUpdate = {
        player1_rounds_won: newP1Rounds,
        player2_rounds_won: newP2Rounds
      };

      if (newP1Rounds >= 2) {
        matchUpdate.status = 'complete';
        matchUpdate.winner_id = match.player1_id;
        await incrementStat(match.player1_id, 'wins');
        await incrementStat(match.player2_id, 'losses');
      } else if (newP2Rounds >= 2) {
        matchUpdate.status = 'complete';
        matchUpdate.winner_id = match.player2_id;
        await incrementStat(match.player2_id, 'wins');
        await incrementStat(match.player1_id, 'losses');
      } else if (newP1Rounds === 1 && newP2Rounds === 1 && round.round_number >= 3) {
        matchUpdate.status = 'tiebreaker';
        await sbPost('arena_tiebreakers', {
          match_id: matchId,
          player1_level: 9,
          player2_level: 9,
          player1_taps: [],
          player2_taps: []
        });
      } else {
        await sbPost('arena_rounds', {
          match_id: matchId,
          round_number: round.round_number + 1,
          player1_hp: 120,
          player2_hp: 120
        });
      }

      await sbPatch('arena_matches', `id=eq.${matchId}`, matchUpdate);
    } else {
      // No KO — create next turn
      await sbPost('arena_turns', {
        round_id: roundId,
        turn_number: turn.turn_number + 1,
        player1_committed: false,
        player2_committed: false,
        resolved: false
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, resolved: true, p1Hp, p2Hp, roundWinner: roundWinnerId, events })
    };
  } catch (err) {
    console.error('Arena action error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
}

async function incrementStat(participantId, field) {
  const rows = await sbGet('arena_participants', `id=eq.${participantId}&select=${field}`);
  const current = rows[0]?.[field] || 0;
  await sbPatch('arena_participants', `id=eq.${participantId}`, { [field]: current + 1 });
}
