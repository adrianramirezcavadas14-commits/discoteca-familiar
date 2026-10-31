#!/usr/bin/env node
// Genera compra/supabase-config.js a partir de compra/.env (solo valores PÚBLICOS).
// Uso: node tools/generar-config.mjs   (desde la carpeta compra/)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
if (!existsSync(envPath)) { console.error('No existe compra/.env. Copia .env.example como .env y rellénalo.'); process.exit(1); }
const env = Object.fromEntries(readFileSync(envPath, 'utf8').split(/\r?\n/)
  .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const url = env.DESPENSA_SUPABASE_URL, key = env.DESPENSA_SUPABASE_PUBLISHABLE_KEY;
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url || '')) { console.error('DESPENSA_SUPABASE_URL no es válida.'); process.exit(1); }
if (!key || /^sb_secret_/.test(key) || /service_role/.test(key)) { console.error('DESPENSA_SUPABASE_PUBLISHABLE_KEY debe ser la clave PÚBLICA (sb_publishable_…).'); process.exit(1); }
writeFileSync(join(root, 'supabase-config.js'), `// Generado por tools/generar-config.mjs. Solo valores públicos.\nwindow.DESPENSA_SUPABASE = {\n  url: ${JSON.stringify(url.replace(/\/$/, ''))},\n  publishableKey: ${JSON.stringify(key)}\n};\n`);
console.log('compra/supabase-config.js actualizado.');
