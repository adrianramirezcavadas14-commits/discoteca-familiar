/* =====================================================================
   «El rincón de los números» · Mismo estilo de gráficas que la discoteca
   y la biblioteca. Datos neutrales: nunca se compara de forma negativa.
   ===================================================================== */
import { S, productById } from '../data/store.js';
import { api, explainError } from '../data/api.js';
import { applyFilters, shopperSummary, purchasesByYear, purchasesByMonth, averageEvolution, topMissing, deviationText } from '../core/stats.js';
import { esc, fmtDuration, fmtEur, plural } from '../core/text.js';
import { productImg } from '../ui/dom.js';
import { SHOPPERS, MONTHS } from '../config.js';

const ui = { sessions: [], results: [], loaded: false, error: '', f: { year: '', month: '', person: '', from: '', to: '' }, at: 0 };

async function load(el) {
  if (!api.ready || Date.now() - ui.at < 15000) return;
  ui.at = Date.now();
  try {
    const sessions = await api.selectAll('shopping_sessions', (q) => q.eq('status', 'completed').order('ended_at', { ascending: true }),
      { columns: 'id,shopper_profile_id,status,started_at,ended_at,duration_seconds,deviation_pct,planned_items,collected_items,partial_items,missing_items,initial_estimated_total,final_estimated_total,detected_savings' });
    const results = await api.selectAll('shopping_item_results', (q) => q.eq('status', 'out_of_stock'), { columns: 'session_id,product_id,status' });
    Object.assign(ui, { sessions, results, loaded: true, error: '' });
  } catch (e) { ui.error = explainError(e); ui.loaded = true; }
  if (el.classList.contains('active')) paint(el);
}

const people = () => SHOPPERS.map((s) => ({ ...s, id: S.profiles.find((p) => p.code === s.code)?.id || s.code }));

export function render(el) {
  el.innerHTML = `<div class="hero"><div><h2 id="h-numeros">El rincón de los números</h2><p>Tiempos de compra, compras de cada uno y curiosidades del súper.</p></div></div><div data-body></div>`;
  if (!el.dataset.bound) { el.dataset.bound = '1'; el.addEventListener('change', (e) => {
    const k = e.target.dataset.filter;
    if (!k) return;
    ui.f[k] = e.target.value;
    paint(el);
  });
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-clear]')) { ui.f = { year: '', month: '', person: '', from: '', to: '' }; paint(el); }
  }); }
  paint(el);
  load(el);
}

function paint(el) {
  const body = el.querySelector('[data-body]');
  if (!ui.loaded) { body.innerHTML = '<div class="empty-note" style="margin-top:16px">Cargando los números…</div>'; return; }
  if (ui.error) { body.innerHTML = `<div class="offline-banner" style="margin-top:16px">${esc(ui.error)}</div>`; return; }
  const P = people();
  const years = [...new Set(ui.sessions.map((s) => new Date(s.ended_at).getFullYear()))].sort((a, b) => b - a);
  const f = ui.f;
  const filtered = applyFilters(ui.sessions, { year: f.year || null, month: f.month === '' ? null : f.month, person: f.person || null, from: f.from || null, to: f.to || null });
  const ids = new Set(filtered.map((s) => s.id));
  const missing = topMissing(ui.results.filter((r) => ids.has(r.session_id)), 10);
  const savings = filtered.reduce((t, s) => t + Number(s.detected_savings || 0), 0);
  const any = filtered.length > 0;

  body.innerHTML = `
    <div class="filters card" role="group" aria-label="Filtros">
      <label class="field"><span>Año</span><select data-filter="year"><option value="">Todos</option>${years.map((y) => `<option${String(y) === f.year ? ' selected' : ''}>${y}</option>`).join('')}</select></label>
      <label class="field"><span>Mes</span><select data-filter="month"><option value="">Todos</option>${MONTHS.map((m, i) => `<option value="${i}"${String(i) === f.month ? ' selected' : ''}>${m}</option>`).join('')}</select></label>
      <label class="field"><span>Persona</span><select data-filter="person"><option value="">Todas</option>${P.map((p) => `<option value="${esc(p.id)}"${p.id === f.person ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Desde</span><input type="date" data-filter="from" value="${esc(f.from)}"></label>
      <label class="field"><span>Hasta</span><input type="date" data-filter="to" value="${esc(f.to)}"></label>
      ${Object.values(f).some(Boolean) ? '<button type="button" class="btn small ghost" data-clear style="align-self:end">Quitar filtros</button>' : ''}
    </div>

    <div class="person-cards">${P.filter((p) => !f.person || p.id === f.person).map((p) => personCard(p, filtered)).join('')}</div>

    ${!any ? '<div class="empty-note" style="margin-top:16px">Todavía no hay compras terminadas con estos filtros. Cuando se termine la primera, aparecerán aquí las gráficas.</div>' : `
    <div class="stack">
      <article class="stats-card"><h3>Compras por persona y año</h3>${legend(P)}${yearChart(filtered, P)}</article>
      <article class="stats-card"><h3>Compras por persona y mes <small>${f.year ? `en ${esc(f.year)}` : 'todos los años'}</small></h3>${legend(P)}${monthChart(filtered, P)}</article>
      <div class="grid-2">
        <article class="stats-card"><h3>Comparación de tiempos</h3>${timesChart(filtered, P)}</article>
        <article class="stats-card"><h3>Evolución del tiempo medio</h3>${legend(P)}${evolutionChart(filtered, P)}</article>
      </div>
      <div class="grid-2">
        <article class="stats-card"><h3>Lo que más veces no quedaba</h3>${missing.length ? `<div class="missing-list">${missing.map((m) => { const p = productById(m.product_id); return `<div class="missing-item">${productImg(p || {})}<b>${esc(p?.name || 'Producto')}</b><span class="pill bad">${plural(m.times, 'vez', 'veces')}</span></div>`; }).join('')}</div>` : '<div class="empty-note">Todo se ha encontrado siempre. 🎉</div>'}</article>
        <article class="stats-card"><h3>Ahorro por promociones</h3>${savings > 0 ? `<div style="font-size:34px;font-weight:950;color:var(--offer)">${fmtEur(savings)}</div><p class="muted">Diferencia entre el precio anterior declarado por el supermercado y el precio en promoción de lo que se recogió.</p>` : '<div class="empty-note">Sin datos fiables de ahorro todavía: solo se cuentan las promociones que declara el propio supermercado.</div>'}</article>
      </div>
    </div>`}`;
}

function personCard(p, sessions) {
  const s = shopperSummary(sessions, p.id);
  return `<article class="card person-card" style="--pc:${p.color}">
    <h3><i aria-hidden="true"></i>${esc(p.name)}</h3>
    ${s.total ? `<div class="kv">
      <div><small>Tiempo medio</small><b>${fmtDuration(s.avg)}</b></div>
      <div><small>Mejor tiempo</small><b>${fmtDuration(s.best)}</b></div>
      <div><small>Último tiempo</small><b>${fmtDuration(s.last)}</b></div>
      <div><small>Compras</small><b>${s.total}</b></div>
      <div class="wide"><small>Tres últimos</small><b>${s.lastThree.map(fmtDuration).join(' · ')}</b></div>
      <div class="wide"><small>Última frente a su media</small><b>${esc(deviationText(s.lastDeviation))}</b></div>
    </div>` : '<p class="muted">Todavía no hay compras suyas.</p>'}
  </article>`;
}

const legend = (P) => `<div class="legend">${P.map((p) => `<span class="leg"><i class="lc" style="background:${p.color}"></i>${esc(p.name)}</span>`).join('')}</div>`;

function yearChart(sessions, P) {
  const data = purchasesByYear(sessions);
  const years = Object.keys(data).map(Number).sort((a, b) => a - b).slice(-5);
  const max = Math.max(1, ...years.flatMap((y) => P.map((p) => data[y][p.id] || 0)));
  return `<div class="year-bars" role="img" aria-label="${esc(years.map((y) => `${y}: ${P.map((p) => `${p.name} ${data[y][p.id] || 0}`).join(', ')}`).join('; '))}">${years.map((y) => `
    <div class="year-group"><div class="yg-cols">${P.map((p) => { const v = data[y][p.id] || 0; return `<span class="yg-col" style="--pc:${p.color};height:${Math.max(4, Math.round((v / max) * 150))}px" title="${esc(p.name)}: ${v}"><span>${v}</span></span>`; }).join('')}</div><span class="yb-label">${y}</span></div>`).join('')}</div>`;
}

function monthChart(sessions, P) {
  const rows = purchasesByMonth(sessions);
  const max = Math.max(1, ...rows.map((r) => Object.values(r.byPerson).reduce((a, b) => a + b, 0)));
  return `<div class="month-bars">${rows.map((r) => {
    const total = Object.values(r.byPerson).reduce((a, b) => a + b, 0);
    return `<div class="month-row${total ? '' : ' zero'}"><span class="mr-name">${MONTHS[r.month]}</span><span class="mr-track" role="img" aria-label="${esc(`${MONTHS[r.month]}: ${P.map((p) => `${p.name} ${r.byPerson[p.id] || 0}`).join(', ')}`)}">${P.map((p) => `<span class="mr-fill" style="width:${((r.byPerson[p.id] || 0) / max) * 100}%;background:${p.color}"></span>`).join('')}</span><span class="mr-val">${total}</span></div>`;
  }).join('')}</div>`;
}

function timesChart(sessions, P) {
  const rows = P.map((p) => ({ p, s: shopperSummary(sessions, p.id) })).filter((x) => x.s.total);
  if (!rows.length) return '<div class="empty-note">Sin datos.</div>';
  const max = Math.max(...rows.map((x) => x.s.avg));
  return `<div class="hbars">${rows.map(({ p, s }) => `
    <div class="hbar" style="--pc:${p.color}"><span class="hb-name">${esc(p.name)}</span><span class="hb-track"><span class="hb-fill" style="display:block;width:${(s.avg / max) * 100}%"></span></span><span class="hb-val">${fmtDuration(s.avg)}</span></div>`).join('')}</div>
    <p class="muted" style="font-size:13px">Tiempo medio por compra. Cada compra es distinta: depende del tamaño de la lista y de la hora.</p>`;
}

function evolutionChart(sessions, P) {
  const series = P.map((p) => ({ p, ev: averageEvolution(sessions, p.id) })).filter((x) => x.ev.length);
  if (!series.length) return '<div class="empty-note">Sin datos.</div>';
  const keys = [...new Set(series.flatMap((x) => x.ev.map((e) => e.key)))].sort().slice(-12);
  const max = Math.max(...series.flatMap((x) => x.ev.map((e) => e.avg)));
  return `<div class="evo">${keys.map((k) => `<div class="evo-row"><span class="evo-key">${esc(k.split('-').reverse().join('/'))}</span><span class="evo-bars">${series.map(({ p, ev }) => {
    const last = [...ev].filter((e) => e.key <= k).pop();
    return last ? `<span class="evo-bar" style="--pc:${p.color};width:${(last.avg / max) * 100}%" title="${esc(p.name)}: ${esc(fmtDuration(last.avg))}"></span>` : '';
  }).join('')}</span></div>`).join('')}</div>`;
}
