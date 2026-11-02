// node tools/test_dat.mjs : the JS DAT reader must reproduce every file extracted by the python tool (re/assets)
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url)); const { Dat } = await import(here + '/../web/js/dat.js');
const b = fs.readFileSync(here + '/../INSIDE.DAT'); const d = new Dat(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); let ok = 0, bad = 0;
for (const e of d.map.values()) { const f = fs.readFileSync(path.join(here, '../re/assets', e.name)); if (Buffer.compare(f, Buffer.from(d.get(e.name))) === 0) ok++; else { bad++; console.log('MISMATCH', e.name); } }
console.log(d.entries.length, 'entries,', ok, 'files identical,', bad, 'mismatches'); process.exit(bad ? 1 : 0);
