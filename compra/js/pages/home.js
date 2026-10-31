/* Inicio: la semana de un vistazo. */
import { S, profileName, queueInfo } from '../data/store.js';
import { api } from '../data/api.js';
import { listTotals } from '../core/pricing.js';
import { esc, fmtEur, plural, fmtDateTime } from '../core/text.js';
import { syncStatusText } from '../ui/sync.js';
import { SHOPPERS } from '../config.js';

let counts = { tickets: null, news: null, at: 0 };

async function loadCounts(el) {
  if (!api.ready || !navigator.onLine || Date.now() - counts.at < 20000) return;
  counts.at = Date.now();
  try {
    const [t, n] = await Promise.all([
      api.client.from('purchase_receipts').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      api.client.from('catalog_changes').select('id', { count: 'exact', head: true }).is('reviewed_at', null).eq('needs_review', true)
    ]);
    counts = { tickets: t.count ?? null, news: n.count ?? null, at: Date.now() };
    if (el.classList.contains('active')) render(el);
  } catch { /* sin conexión: se muestran sin números */ }
}

export function render(el) {
  const draftItems = [...S.draft.items].map(([product_id, it]) => ({ product_id, quantity: it.quantity }));
  const dt = listTotals(draftItems, S.products);
  const pend = S.pending.list;
  const pendTotals = pend ? listTotals(S.pending.items, S.products) : null;
  const q = queueInfo();
  const me = SHOPPERS.find((s) => s.code === S.me);
  const run = S.sync.active;
  el.innerHTML = `
    <div class="hero"><div><h2 id="h-inicio">${me ? `¡Hola, ${esc(me.name)}!` : 'La despensa de un vistazo'}</h2><p>La lista de la semana, la compra y las novedades del súper.</p></div></div>
    ${!S.serverOk ? `<div class="offline-banner" role="status">📴 Sin conexión con Supabase: estás viendo lo guardado en este dispositivo.${q.pending ? ` ${plural(q.pending, 'cambio espera', 'cambios esperan')} a enviarse.` : ''}</div>` : ''}
    <div class="card sync-card" style="margin-top:16px">
      <div class="hc-icon" aria-hidden="true" style="width:46px;height:46px;border-radius:14px;display:grid;place-items:center;font-size:24px;background:var(--shop-soft)">🔭</div>
      <div class="sc-text"><b>Catálogo del súper</b><div class="muted">${esc(syncStatusText())}</div>
        ${run ? `<div class="progress" style="margin-top:8px" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${run.categories_total ? Math.round(run.categories_done / run.categories_total * 100) : 0}"><i style="width:${run.categories_total ? Math.round(run.categories_done / run.categories_total * 100) : 0}%"></i></div>` : ''}
        ${S.sync.lastFailed && (!S.sync.last || S.sync.lastFailed.finished_at > S.sync.last.finished_at) ? `<div class="muted" style="font-size:13px;margin-top:4px">⚠️ El último intento falló (${esc(fmtDateTime(S.sync.lastFailed.finished_at))}); se usa el último catálogo correcto.</div>` : ''}
      </div>
      <a class="btn small ghost" href="#ajustes">Ajustes</a>
    </div>
    <div class="home-grid">
      <article class="card home-card">
        <div class="hc-icon" aria-hidden="true">📝</div>
        <h3>Lista en preparación</h3>
        ${dt.products ? `<div class="big">${fmtEur(dt.total)}</div><div class="muted">${plural(dt.products, 'producto', 'productos')} · ${plural(dt.units, 'unidad', 'unidades')}</div>` : '<div class="muted">Todavía no hay nada apuntado esta semana.</div>'}
        <a class="btn primary" href="#lista">${dt.products ? 'Seguir apuntando' : 'Empezar la lista'}</a>
      </article>
      <article class="card home-card">
        <div class="hc-icon" aria-hidden="true">🛒</div>
        <h3>La compra</h3>
        ${pend ? `<div class="big">${fmtEur(pendTotals.total)}</div><div class="muted">${pend.status === 'shopping' ? `En curso${S.session?.session ? ` · ${esc(profileName(S.session.session.shopper_profile_id))}` : ''}` : 'Lista cerrada, lista para comprar'} · ${plural(pendTotals.products, 'producto', 'productos')}</div>` : '<div class="muted">No hay ninguna compra pendiente.</div>'}
        <a class="btn ${pend ? 'primary' : 'ghost'}" href="#compra">${pend ? (pend.status === 'shopping' ? 'Volver a la compra' : '¡A por la compra!') : 'Ver'}</a>
      </article>
      <article class="card home-card">
        <div class="hc-icon" aria-hidden="true">🧾</div>
        <h3>Tickets por saldar</h3>
        <div class="big">${counts.tickets ?? '—'}</div><div class="muted">${counts.tickets ? 'pendientes de pago' : 'Todo saldado'}</div>
        <a class="btn ghost" href="#tickets">Ver tickets</a>
      </article>
      <article class="card home-card">
        <div class="hc-icon" aria-hidden="true">✨</div>
        <h3>Lo nuevo del súper</h3>
        <div class="big">${counts.news ?? '—'}</div><div class="muted">${counts.news ? 'novedades por revisar' : 'Nada pendiente de revisar'}</div>
        <a class="btn ghost" href="#novedades">Ver novedades</a>
      </article>
      <article class="card home-card">
        <div class="hc-icon" aria-hidden="true">🗺️</div>
        <h3>El mapa del súper</h3>
        <div class="muted">${S.zones.length} zonas · ${plural([...S.products.values()].filter((p) => p.visible_in_app && p.active).length, 'producto', 'productos')} en el catálogo</div>
        <a class="btn ghost" href="#mapa">Abrir el mapa</a>
      </article>
      <article class="card home-card">
        <div class="hc-icon" aria-hidden="true">🏆</div>
        <h3>El rincón de los números</h3>
        <div class="muted">Tiempos de cada uno, compras por mes y productos que más se agotan.</div>
        <a class="btn ghost" href="#numeros">Ver los números</a>
      </article>
    </div>`;
  loadCounts(el);
}
