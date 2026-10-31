/* =====================================================================
   «Lo nuevo del súper» · Novedades, precios, retirados y registro de
   sincronizaciones (con sus errores).
   ===================================================================== */
import { S, productById, zoneById, zoneIdOf } from '../data/store.js';
import { api, explainError } from '../data/api.js';
import { productImg, toast } from '../ui/dom.js';
import { loadPendingNew, reviewNewProducts, refreshNewsBadge, runEntryReviews } from '../ui/review.js';
import { esc, fmtEur, fmtDateTime, fmtPct, plural } from '../core/text.js';

const TABS = [
  { id: 'new', label: 'Nuevos', types: ['new_product'] },
  { id: 'removed', label: 'Retirados', types: ['possibly_removed', 'removed', 'reappeared', 'temporarily_unavailable', 'available_again'] },
  { id: 'price', label: 'Precios', types: ['price_decrease', 'price_increase'] },
  { id: 'promo', label: 'Promociones', types: ['promo_start', 'promo_end'] },
  { id: 'other', label: 'Otros cambios', types: ['name_change', 'format_change', 'category_change', 'subcategory_change', 'photo_change'] },
  { id: 'runs', label: 'Sincronizaciones', types: [] }
];
const LABEL = {
  new_product: 'Producto nuevo', possibly_removed: 'Ya no aparece (posiblemente retirado)', removed: 'Retirado definitivamente (3 sincronizaciones sin aparecer)',
  reappeared: 'Ha vuelto a aparecer', temporarily_unavailable: 'Temporalmente no disponible', available_again: 'Vuelve a estar disponible',
  price_decrease: 'Bajada de precio', price_increase: 'Subida de precio', promo_start: 'Promoción declarada por el supermercado', promo_end: 'Fin de la promoción',
  name_change: 'Cambio de nombre', format_change: 'Cambio de formato', category_change: 'Cambio de categoría', subcategory_change: 'Cambio de subcategoría', photo_change: 'Foto actualizada'
};
const ui = { tab: 'new', changes: [], runs: [], loaded: false, error: '', at: 0 };

async function load(el, force = false) {
  if (!api.ready || (!force && Date.now() - ui.at < 15000)) return;
  ui.at = Date.now();
  try {
    const since = new Date(Date.now() - 90 * 86400000).toISOString();
    const [changes, runs] = await Promise.all([
      api.select('catalog_changes', (q) => q.gte('detected_at', since).order('detected_at', { ascending: false }).limit(800)),
      api.select('catalog_sync_runs', (q) => q.order('started_at', { ascending: false }).limit(25), 'id,status,trigger_kind,provider,requested_by,started_at,finished_at,categories_total,categories_done,categories_failed,products_seen,stats,error,is_baseline')
    ]);
    Object.assign(ui, { changes, runs, loaded: true, error: '' });
  } catch (e) { ui.error = explainError(e); ui.loaded = true; }
  if (el.classList.contains('active')) paint(el);
}

export function render(el) {
  el.innerHTML = `<div class="hero"><div><h2 id="h-novedades">Lo nuevo del súper</h2><p>Productos nuevos, retirados, cambios de precio y promociones de los últimos 90 días.</p></div></div><div data-body></div>`;
  el.onclick = (e) => onClick(e, el);
  paint(el);
  load(el);
}
export function update(el, params, what) { if (what === 'catalog' || what === 'sync') load(el, true); }

function describe(c) {
  const o = c.old_value || {}, n = c.new_value || {};
  switch (c.change_type) {
    case 'price_decrease': case 'price_increase':
      return `${fmtEur(o.price)} → <b>${fmtEur(n.price)}</b> (${n.diff > 0 ? '+' : ''}${fmtEur(n.diff)} · ${fmtPct(n.pct)})${n.promo ? ' · promoción' : ''}`;
    case 'promo_start': return `${fmtEur(n.price)} (antes ${fmtEur(n.previous)})`;
    case 'promo_end': return `Vuelve a ${fmtEur(n.price)}`;
    case 'name_change': return `«${esc(o.name)}» → «${esc(n.name)}»`;
    case 'format_change': return `${esc(o.format || o.packaging || '—')} → ${esc(n.format || n.packaging || '—')}`;
    case 'category_change': case 'subcategory_change': return `${esc(o.name || o.id || '—')} → ${esc(n.name || n.id || '—')}`;
    case 'new_product': return `${esc(n.category || '')} › ${esc(n.subcategory || '')} · ${fmtEur(n.price)}`;
    default: return '';
  }
}

function paint(el) {
  const body = el.querySelector('[data-body]');
  const counts = Object.fromEntries(TABS.map((t) => [t.id, t.id === 'runs' ? ui.runs.length : ui.changes.filter((c) => t.types.includes(c.change_type)).length]));
  const tab = TABS.find((t) => t.id === ui.tab);
  const list = ui.changes.filter((c) => tab.types.includes(c.change_type));
  const unreviewedNew = ui.changes.filter((c) => c.change_type === 'new_product' && !c.reviewed_at && c.needs_review).length;
  const unreviewed = list.filter((c) => !c.reviewed_at && c.needs_review);
  body.innerHTML = `
    <div class="tabs" role="tablist" aria-label="Tipo de novedad">${TABS.map((t) => `<button type="button" class="tab" role="tab" data-tab="${t.id}" aria-selected="${t.id === ui.tab}">${t.label}<span class="count">${counts[t.id]}</span></button>`).join('')}</div>
    ${ui.error ? `<div class="offline-banner">${esc(ui.error)}</div>` : ''}
    ${!ui.loaded ? '<div class="empty-note">Cargando novedades…</div>' : ''}
    ${ui.tab === 'new' && unreviewedNew ? `<div class="row" style="margin-bottom:10px"><button type="button" class="btn primary" data-review-new>Revisar las zonas de ${plural(unreviewedNew, 'producto nuevo', 'productos nuevos')}</button></div>` : ''}
    ${ui.tab === 'removed' && unreviewed.length ? '<div class="row" style="margin-bottom:10px"><button type="button" class="btn ghost" data-review-lists>Revisar mis listas</button></div>' : ''}
    ${ui.tab !== 'new' && ui.tab !== 'runs' && unreviewed.length ? `<div class="row" style="margin-bottom:10px"><button type="button" class="btn ghost" data-seen>Marcar como vistas (${unreviewed.length})</button></div>` : ''}
    ${ui.tab === 'runs' ? runsHtml() : ui.loaded && !list.length ? '<div class="empty-note">Nada por aquí en los últimos 90 días.</div>' : `<div class="change-list">${list.slice(0, 300).map(changeHtml).join('')}</div>`}`;
}

function changeHtml(c) {
  const p = productById(c.product_id);
  const z = zoneById(zoneIdOf(c.product_id));
  const red = ['price_decrease', 'promo_start'].includes(c.change_type);
  return `<div class="change">
    ${productImg(p || {})}
    <div class="ch-main"><b>${esc(p?.name || 'Producto')}</b><small>${LABEL[c.change_type] || c.change_type}${z ? ` · zona ${z.route_order}` : ''}${p && !p.visible_in_app ? ' · categoría oculta' : ''}</small><small${red ? ' style="color:var(--offer)"' : ''}>${describe(c)}</small></div>
    <div class="ch-side"><small class="muted">${esc(fmtDateTime(c.detected_at))}</small>${c.needs_review && !c.reviewed_at ? '<span class="pill warn">Sin revisar</span>' : c.reviewed_at ? `<span class="pill grey">Visto${c.reviewed_by ? ` · ${esc(c.reviewed_by)}` : ''}</span>` : ''}</div>
  </div>`;
}

function runsHtml() {
  if (!ui.runs.length) return '<div class="empty-note">Todavía no se ha sincronizado el catálogo.</div>';
  const ST = { completed: '✅ Completada', failed: '⚠️ Fallida', running: '🔄 En marcha', applying: '🔄 Aplicando', aborted: '⏹ Interrumpida' };
  return `<div class="run-log">${ui.runs.map((r) => {
    const s = r.stats || {};
    return `<div class="run"><b>${ST[r.status] || r.status}</b>${esc(fmtDateTime(r.started_at))}${r.finished_at ? ` → ${esc(fmtDateTime(r.finished_at))}` : ''} · ${r.trigger_kind === 'manual' ? 'manual' : 'automática'}${r.requested_by ? ` (${esc(r.requested_by)})` : ''} · fuente: ${esc(r.provider || '—')}
      <div class="muted" style="font-size:13px">${r.categories_done}/${r.categories_total} categorías · ${r.products_seen || 0} productos${r.is_baseline ? ' · primera carga' : ''}${s.new ? ` · ${s.new} nuevos` : ''}${s.changes ? ` · ${s.changes} cambios` : ''}${s.missing_changes ? ` · ${s.missing_changes} ausencias` : ''}</div>
      ${r.error ? `<div style="color:#9a2c23;font-size:13px;font-weight:700">${esc(r.error)}</div>` : ''}</div>`;
  }).join('')}</div>`;
}

async function onClick(e, el) {
  const t = e.target;
  const tab = t.closest('[data-tab]');
  if (tab) { ui.tab = tab.dataset.tab; paint(el); return; }
  if (t.closest('[data-review-new]')) {
    const news = await loadPendingNew().catch(() => []);
    if (!news.length) { toast('No hay productos nuevos visibles por revisar.'); return; }
    await reviewNewProducts(news);
    await load(el, true);
    refreshNewsBadge();
    return;
  }
  if (t.closest('[data-review-lists]')) { await runEntryReviews({ force: true }); await load(el, true); return; }
  if (t.closest('[data-seen]')) {
    const tabDef = TABS.find((x) => x.id === ui.tab);
    const ids = ui.changes.filter((c) => tabDef.types.includes(c.change_type) && !c.reviewed_at && c.needs_review).map((c) => c.id);
    try { await api.rpc('review_changes', { p_change_ids: ids, p_actor: S.me }); toast('Marcadas como vistas.'); await load(el, true); refreshNewsBadge(); }
    catch (err) { toast(explainError(err), 4000); }
  }
}
