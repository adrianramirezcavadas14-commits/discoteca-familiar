/* =====================================================================
   «El rincón de los números» · Mismo estilo de gráficas que la discoteca
   y la biblioteca. Datos neutrales: nunca se compara de forma negativa.
   ===================================================================== */
import { S, productById } from '../data/store.js';
import { api, explainError } from '../data/api.js';
import { shopperSummary, purchasesByYear, purchasesByMonth, topMissing, deviationText, cumulativeAverageSeries, fmtMinutes } from '../core/stats.js';
import { esc, fmtDuration, fmtEur, plural } from '../core/text.js';
import { productImg } from '../ui/dom.js';
import { SHOPPERS, MONTHS } from '../config.js';

const ui = { sessions: [], results: [], loaded: false, error: '', at: 0 };

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
  if (!el.dataset.bound) {
    el.dataset.bound = '1';
    // Información de cada punto de la gráfica al tocarlo (o con el teclado).
    const showTip = (b) => { const tip = el.querySelector('[data-lc-tip]'); if (tip && b) { tip.textContent = b.dataset.tip; el.querySelectorAll('.lc-pt.on').forEach((x) => x.classList.remove('on')); b.classList.add('on'); } };
    el.addEventListener('click', (e) => showTip(e.target.closest('.lc-pt')));
    el.addEventListener('focusin', (e) => showTip(e.target.closest('.lc-pt')));
  }
  paint(el);
  load(el);
}

function paint(el) {
  const body = el.querySelector('[data-body]');
  if (!ui.loaded) { body.innerHTML = '<div class="empty-note" style="margin-top:16px">Cargando los números…</div>'; return; }
  if (ui.error) { body.innerHTML = `<div class="offline-banner" style="margin-top:16px">${esc(ui.error)}</div>`; return; }
  const P = people();
  // Sin filtros: todas las compras terminadas.
  const filtered = ui.sessions.filter((s) => s.status === 'completed' && s.ended_at);
  const ids = new Set(filtered.map((s) => s.id));
  const missing = topMissing(ui.results.filter((r) => ids.has(r.session_id)), 10);
  const savings = filtered.reduce((t, s) => t + Number(s.detected_savings || 0), 0);
  const any = filtered.length > 0;

  body.innerHTML = `
    <article class="stats-card avg-card" style="margin-top:16px"><h3>Evolución del tiempo medio de compra <small>media acumulada de cada persona, compra a compra</small></h3>${legend(P)}${lineChart(filtered, P)}</article>

    <div class="person-cards">${P.map((p) => personCard(p, filtered)).join('')}</div>

    ${!any ? '<div class="empty-note" style="margin-top:16px">Todavía no hay compras terminadas. Cuando se termine la primera, aparecerán aquí las gráficas.</div>' : `
    <div class="stack">
      <article class="stats-card"><h3>Compras por persona y año</h3>${legend(P)}${yearChart(filtered, P)}</article>
      <article class="stats-card"><h3>Compras por persona y mes <small>todos los años</small></h3>${legend(P)}${monthChart(filtered, P)}</article>
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

/**
 * Gráfica de líneas de la media acumulada del tiempo de compra.
 * Eje X común (todas las compras en orden cronológico): cada compra es un punto en su
 * posición, así las líneas de las personas son comparables. Eje Y: minutos.
 */
function lineChart(sessions, P) {
  const { points, byPerson, total } = cumulativeAverageSeries(sessions);
  if (!total) return '<div class="empty-note">Cuando se termine la primera compra aparecerá aquí su punto.</div>';
  const maxAvg = Math.max(...points.map((p) => p.avg));
  const step = niceStep(maxAvg / 4);
  const top = Math.max(step, Math.ceil(maxAvg / step) * step);
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  const xPct = (x) => (total === 1 ? 50 : ((x - 1) / (total - 1)) * 100);
  const yPct = (v) => 100 - (v / top) * 100;
  const name = (id) => P.find((p) => p.id === id)?.name || 'Otra persona';
  const color = (id) => P.find((p) => p.id === id)?.color || '#687086';
  const lines = [...byPerson].map(([id, pts]) => (pts.length > 1
    ? `<polyline fill="none" stroke="${esc(color(id))}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" points="${pts.map((p) => `${(xPct(p.x) * 10).toFixed(1)},${(yPct(p.avg) * 10).toFixed(1)}`).join(' ')}"/>`
    : '')).join('');
  const grid = ticks.map((v) => `<line x1="0" x2="1000" y1="${(yPct(v) * 10).toFixed(1)}" y2="${(yPct(v) * 10).toFixed(1)}" stroke="#ece4d6" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join('');
  const fmtDay = (d) => new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  const dots = points.map((p) => {
    const tip = `${name(p.personId)} · compra ${p.x} (${fmtDay(p.at)}) · duró ${fmtMinutes(p.minutes)} · su media tras ${p.n} ${p.n === 1 ? 'compra' : 'compras'}: ${fmtMinutes(p.avg)}`;
    return `<button type="button" class="lc-pt" style="left:${xPct(p.x).toFixed(3)}%;top:${yPct(p.avg).toFixed(3)}%;--pc:${esc(color(p.personId))}" data-tip="${esc(tip)}" aria-label="${esc(tip)}" title="${esc(tip)}"></button>`;
  }).join('');
  const every = Math.max(1, Math.ceil(total / 8));
  const xlabels = points.filter((p) => p.x === 1 || p.x === total || p.x % every === 0).map((p) => `<span class="lc-x" style="left:${xPct(p.x).toFixed(3)}%">${p.x}</span>`).join('');
  const ylabels = ticks.map((v) => `<span class="lc-y" style="top:${yPct(v).toFixed(3)}%">${(Math.round(v * 100) / 100).toLocaleString('es-ES')}</span>`).join('');
  return `<div class="line-chart" role="group" aria-label="Media acumulada del tiempo de compra por persona, en minutos, para ${total} compras en orden cronológico">
      <span class="lc-unit" aria-hidden="true">min</span>
      <div class="lc-plot">
        <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true" focusable="false">${grid}${lines}</svg>
        ${dots}
        <div class="lc-ylabels" aria-hidden="true">${ylabels}</div>
        <div class="lc-xlabels" aria-hidden="true">${xlabels}</div>
      </div>
    </div>
    <p class="lc-axis muted" aria-hidden="true">Compras en orden cronológico (1 = la primera)</p>
    <p class="lc-tip" data-lc-tip aria-live="polite">Toca un punto para ver la compra y la media de esa persona en ese momento.</p>`;
}

/** Paso «bonito» para las marcas del eje (1, 2, 5, 10, 20…). */
function niceStep(raw) {
  const r = Math.max(raw, 0.5);
  const pow = 10 ** Math.floor(Math.log10(r));
  const n = r / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
