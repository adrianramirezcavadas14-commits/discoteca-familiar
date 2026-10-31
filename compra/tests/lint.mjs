// Revisión estática sin dependencias: sintaxis de todos los módulos, importaciones sin usar,
// importaciones que no existen, ids duplicados en el HTML y secretos que no deben estar en el repositorio.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? (f === 'node_modules' ? [] : walk(p)) : [p]; });
const files = walk(root);
const rx = (n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (n) => `(?<![\\w$])${rx(n)}(?![\\w$])`;
const js = files.filter((f) => /\.(m?js)$/.test(f));

for (const f of js) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { problems.push(`${relative(root, f)}: error de sintaxis\n${e.stderr}`); }
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/^import\s+\{([^}]+)\}\s+from\s+'([^']+)'/gm)) {
    const names = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean);
    const body = src.slice(m.index + m[0].length);
    for (const n of names) if (!new RegExp(word(n)).test(body)) problems.push(`${relative(root, f)}: importación sin usar «${n}»`);
    if (m[2].startsWith('.')) {
      const target = join(dirname(f), m[2]);
      let tsrc = '';
      try { tsrc = readFileSync(target, 'utf8'); } catch { problems.push(`${relative(root, f)}: no existe ${m[2]}`); continue; }
      for (const n of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
        if (!new RegExp(`export\\s+(async\\s+)?(function|const|let|class)\\s+${word(n)}|export\\s*\\{[^}]*${word(n)}`).test(tsrc)) problems.push(`${relative(root, f)}: «${n}» no se exporta en ${m[2]}`);
      }
    }
  }
  if (/^\s*void\s+\w+;/m.test(src)) problems.push(`${relative(root, f)}: «void» para silenciar importaciones`);
}

for (const f of files.filter((x) => x.endsWith('.html'))) {
  const src = readFileSync(f, 'utf8');
  const ids = [...src.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dup.length) problems.push(`${relative(root, f)}: ids duplicados ${[...new Set(dup)].join(', ')}`);
}

for (const f of files.filter((x) => !x.includes('node_modules') && /\.(js|mjs|ts|html|sql|md|toml|example)$/.test(x))) {
  const src = readFileSync(f, 'utf8');
  if (/sb_secret_[A-Za-z0-9]/.test(src) || /"role"\s*:\s*"service_role"/.test(src) || /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{10,}/.test(src)) problems.push(`${relative(root, f)}: posible secreto en el repositorio`);
}

// El service worker de Hogar debe precargar todos los módulos de la despensa (para abrirla sin cobertura).
const sw = readFileSync(join(root, '..', 'service-worker.js'), 'utf8');
for (const f of js.filter((x) => x.startsWith(join(root, 'js')))) {
  const rel = `./compra/${relative(root, f).split('\\').join('/')}`;
  if (!sw.includes(`'${rel}'`)) problems.push(`service-worker.js: falta precargar ${rel}`);
}
for (const gif of ['coyote.gif']) if (!sw.includes(`./compra/${gif}`)) problems.push(`service-worker.js: falta ${gif}`);

if (problems.length) { console.error(problems.join('\n')); console.error(`\n${problems.length} problemas`); process.exit(1); }
console.log(`Lint correcto: ${js.length} módulos JavaScript revisados.`);
