// Writes src/data/sim/options.json from netlify/data/sim; npm run build runs it first.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadTables } from '../../netlify/lib/sim/tables.js';
import { buildOptions } from '../../netlify/lib/sim/options.js';

const out = fileURLToPath(new URL('../../src/data/sim/options.json', import.meta.url));
fs.mkdirSync(new URL('../../src/data/sim/', import.meta.url), { recursive: true });
const text = JSON.stringify(buildOptions(loadTables()));
fs.writeFileSync(out, `${text}\n`);
console.log(`options.json ${(text.length / 1024).toFixed(1)} KB -> ${out}`);
