// Server-side simulator tables, read with fs so Netlify ships them as included_files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TABLE_NAMES = ['equipment', 'jewelry', 'sets', 'potentials', 'heraldry', 'cards', 'talismans', 'runes',
  'engraving', 'costumes', 'titles', 'collection', 'mastery', 'class_base', 'job_map', 'effective_panel',
  'attribute_order', 'conversion', 'lists', 'defaults', 'buffs'];

// Deployed functions are bundled, so the data dir is found rather than assumed.
export function dataDir() {
  const candidates = [];
  try { candidates.push(fileURLToPath(new URL('../../data/sim/', import.meta.url))); } catch (e) { /* no module url */ }
  for (const root of [process.env.LAMBDA_TASK_ROOT, process.cwd()]) if (root) candidates.push(path.join(root, 'netlify', 'data', 'sim'));
  const found = candidates.find((dir) => fs.existsSync(path.join(dir, 'equipment.json')));
  if (!found) throw new Error(`simulator tables not found; looked in ${candidates.join(', ')}`);
  return found;
}

export function loadTables(dir = dataDir()) {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
  const tables = Object.fromEntries(TABLE_NAMES.map((name) => [name, read(name)]));
  const clientPath = path.join(dir, 'gear-client.json');
  if (fs.existsSync(clientPath)) mergeClientGear(tables, JSON.parse(fs.readFileSync(clientPath, 'utf8')));
  // Damage skills per class, from tools/pak/build_sim_skills.py.
  const skillsPath = path.join(dir, 'skills.json');
  if (fs.existsSync(skillsPath)) tables.skills = JSON.parse(fs.readFileSync(skillsPath, 'utf8'));
  return tables;
}

// Client epic and unique gear; the toolbox tables win on shared names.
function mergeClientGear(tables, clientGear) {
  const { equipment, sets, jewelry, lists, job_map: jobMap } = tables;
  for (const [job, items] of Object.entries(clientGear.equipment)) equipment[job] = { ...items, ...(equipment[job] || {}) };
  Object.assign(sets.bonus, clientGear.sets.bonus);
  Object.assign(sets.names, clientGear.sets.names);
  for (const [job, members] of Object.entries(clientGear.sets.equipment)) sets.equipment[job] = { ...members, ...(sets.equipment[job] || {}) };
  for (const [slot, members] of Object.entries(clientGear.sets.jewelry)) sets.jewelry[slot] = { ...members, ...(sets.jewelry[slot] || {}) };
  for (const [slot, items] of Object.entries(clientGear.jewelry)) {
    jewelry.items[slot] = { ...items, ...(jewelry.items[slot] || {}) };
    const options = lists.jewelry[slot];
    if (options) for (const name of Object.keys(items)) if (!options.includes(name)) options.push(name);
  }
  for (const [second, { first_job: first, base_class: base }] of Object.entries(jobMap)) {
    const slots = lists.equipment[second];
    if (!slots) continue;
    for (const job of [second, first, base]) {
      for (const [name, item] of Object.entries(clientGear.equipment[job] || {})) {
        const options = slots[item.slot];
        if (options && !options.includes(name)) options.push(name);
      }
    }
  }
}

let cached = null;
export function getTables() {
  cached ??= loadTables();
  return cached;
}
