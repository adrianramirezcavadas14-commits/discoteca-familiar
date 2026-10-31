/* =====================================================================
   Avisos al entrar: productos nuevos (con su zona) y productos retirados
   que siguen en una lista abierta.
   ===================================================================== */
import { api, explainError } from '../data/api.js';
import { S, productById, zoneById, zoneIdOf, zonesByRoute, refreshOverrides, adjustPendingItem, flushDraft, selectable, productsInZone } from '../data/store.js';
import { needsZoneQuestion } from '../core/zones.js';
import { esc, fmtEur, plural, norm } from '../core/text.js';
import { openPanel, closePanel, priceHtml, availabilityPill } from './cards.js';
import { productImg, $, toast, confirmDialog } from './dom.js';
import { broadcast } from './nav.js';

let reviewing = false;
let snoozed = false;

export async function loadPendingNew() {
  const rows = await api.select('catalog_changes', (q) => q.eq('change_type', 'new_product').is('reviewed_at', null).eq('needs_review', true).order('detected_at', { ascending: false }).limit(300), 'id,product_id,detected_at');
  return rows.map((r) => ({ ...r, product: productById(r.product_id) })).filter((r) => r.product && r.product.visible_in_app);
}

export async function refreshNewsBadge() {
  const b = $('#navBadgeNews');
  if (!b || !api.ready || !navigator.onLine) return;
  try {
    const { count } = await api.client.from('catalog_changes').select('id', { count: 'exact', head: true }).is('reviewed_at', null).eq('needs_review', true);
    b.hidden = !count;
    b.textContent = count > 99 ? '99+' : String(count || '');
    b.setAttribute('aria-label', `${count} novedades sin revisar`);
  } catch { b.hidden = true; }
}

export async function runEntryReviews({ force = false } = {}) {
  if (reviewing || !api.ready || !navigator.onLine || (snoozed && !force)) return;
  reviewing = true;
  try {
    const news = await loadPendingNew();
    if (news.length) await reviewNewProducts(news);
    await reviewUnavailableInLists();
  } catch (e) {
    console.warn('Revisión de novedades no disponible', e);
  } finally {
    reviewing = false;
    refreshNewsBadge();
  }
}

/** «Hemos encontrado 8 productos nuevos»: foto, datos, zona propuesta y selector cuando hace falta. */
export function reviewNewProducts(news) {
  const zones = zonesByRoute();
  const ctx = { overrides: S.overrides, rulesIndex: S.rulesIndex, manualConfirmIds: S.settings.manual_confirm_category_ids || [], sectionZones: S.sectionZones };
  const options = (sel) => `<option value="">Sin zona</option>${zones.map((z) => `<option value="${esc(z.id)}"${z.id === sel ? ' selected' : ''}>${z.route_order} · ${esc(z.name)}</option>`).join('')}`;
  const items = news.map((n) => {
    const p = n.product;
    const zid = zoneIdOf(p.id);
    const z = zoneById(zid);
    const ask = needsZoneQuestion(p, ctx);
    return `<div class="review-item" data-change="${n.id}" data-pid="${esc(p.id)}" data-ask="${ask ? 1 : 0}" data-auto="${esc(zid || '')}">
      ${productImg(p)}
      <div>
        <b>${esc(p.name)}</b>
        <div class="muted" style="font-size:13px;font-weight:700">${esc(p.category_name || '')} › ${esc(p.subcategory_name || '')}${p.format_label ? ` · ${esc(p.format_label)}` : ''}</div>
        <div>${priceHtml(p)}</div>
        ${ask
          ? `<label class="field" style="margin-top:6px"><span>${z ? 'Propuesta (confírmala o cámbiala)' : '¿En qué zona está?'}</span><select data-zone-select aria-label="Zona de ${esc(p.name)}">${options(zid)}</select></label>`
          : `<div class="row" style="margin-top:6px"><span class="pill">Zona ${z.route_order} · ${esc(z.name)}</span><button type="button" class="btn small ghost" data-change-zone>Cambiar</button></div>
             <label class="field" hidden data-zone-wrap><span>Zona</span><select data-zone-select aria-label="Zona de ${esc(p.name)}">${options(zid)}</select></label>`}
      </div>
    </div>`;
  }).join('');
  const asked = news.filter((n) => needsZoneQuestion(n.product, ctx)).length;
  return new Promise((resolve) => {
    const body = openPanel(`Hemos encontrado ${plural(news.length, 'producto nuevo', 'productos nuevos')}`, `
      <p class="muted">${asked ? `En ${plural(asked, 'producto', 'productos')} necesitamos que nos digas la zona. El resto hereda la de su subcategoría.` : 'Todos heredan la zona de su subcategoría. Puedes cambiar cualquiera.'}</p>
      <div class="stack" style="margin-top:8px">${items}</div>
      <div class="form-error" id="reviewError" role="alert"></div>
      <div class="row end" style="margin-top:14px">
        <button type="button" class="btn ghost" data-later>Más tarde</button>
        <button type="button" class="btn primary" data-save>Confirmar zonas</button>
      </div>`, { onClose: () => resolve(false) });
    body.onclick = async (e) => {
      const ch = e.target.closest('[data-change-zone]');
      if (ch) { const it = ch.closest('.review-item'); it.querySelector('[data-zone-wrap]').hidden = false; ch.parentElement.hidden = true; it.querySelector('select').focus(); return; }
      if (e.target.closest('[data-later]')) { snoozed = true; closePanel(); return; }
      if (!e.target.closest('[data-save]')) return;
      const payload = [...body.querySelectorAll('.review-item')].map((it) => {
        const sel = it.querySelector('select');
        const chosen = sel && (it.dataset.ask === '1' || !sel.closest('[data-zone-wrap]')?.hidden) ? (sel.value || null) : null;
        return { change_id: Number(it.dataset.change), product_id: it.dataset.pid, zone_id: chosen && chosen !== '' ? chosen : null, _changed: chosen !== null && chosen !== it.dataset.auto };
      });
      const btn = e.target.closest('[data-save]');
      btn.disabled = true;
      try {
        await api.rpc('review_new_products', { p_items: payload.map(({ _changed, ...x }) => x), p_actor: S.me });
        // Las excepciones las crea el servidor solo si la zona elegida difiere de la automática
        if (payload.some((x) => x.zone_id)) { await refreshOverrides().catch(() => {}); broadcast('zones'); }
        toast('Zonas de los productos nuevos guardadas.');
        closePanel();
        resolve(true);
      } catch (err) {
        $('#reviewError').textContent = explainError(err);
        btn.disabled = false;
      }
    };
  });
}

/** Productos retirados o sin existencias que siguen en una lista abierta o pendiente. */
export async function reviewUnavailableInLists() {
  const entries = [];
  for (const [pid, it] of S.draft.items) {
    const p = productById(pid);
    if (p && p.availability !== 'available' && !it.unavailable_ack_at) entries.push({ p, qty: it.quantity, where: 'draft' });
  }
  for (const it of S.pending.items || []) {
    const p = productById(it.product_id);
    if (S.pending.list?.status === 'ready_to_shop' && p && p.availability !== 'available' && !it.unavailable_ack_at) entries.push({ p, qty: it.quantity, where: 'pending' });
  }
  const removedCount = await countUnreviewedRemovals();
  if (!entries.length && !removedCount.count) return;
  if (!entries.length) {
    // Solo información: ningún producto retirado estaba en una lista.
    await api.rpc('review_changes', { p_change_ids: removedCount.ids, p_actor: S.me }).catch(() => {});
    toast(`${removedCount.count === 1 ? 'Ya no aparece 1 producto' : `Ya no aparecen ${removedCount.count} productos`} en el catálogo (ninguno estaba en tu lista).`, 4500);
    return;
  }
  if (S.draft.dirty.size) await flushDraft().catch(() => {});
  const rows = entries.map(({ p, qty, where }) => `
    <div class="change" data-pid="${esc(p.id)}" data-where="${where}">
      ${productImg(p)}
      <div class="ch-main"><b>${esc(p.name)}</b><small>${qty} ud. · ${where === 'draft' ? 'lista en preparación' : 'lista cerrada'} · ${availabilityPill(p)}</small></div>
      <div class="ch-side">
        <button type="button" class="btn small ghost" data-act="keep">Conservar</button>
        <button type="button" class="btn small ghost" data-act="replace">Sustituir</button>
        <button type="button" class="btn small danger" data-act="remove">Eliminar</button>
      </div>
    </div>`).join('');
  return new Promise((resolve) => {
    const total = removedCount.count || entries.length;
    const body = openPanel(`${total === 1 ? 'Ya no aparece 1 producto' : `Ya no aparecen ${total} productos`} en el catálogo`, `
      <p class="muted">${plural(entries.length, 'producto de tus listas no está disponible ahora mismo', 'productos de tus listas no están disponibles ahora mismo')}. No se borran solos: decide qué hacer con cada uno.</p>
      <div class="change-list">${rows}</div>
      <div class="form-error" id="unavError" role="alert"></div>`, { onClose: () => resolve() });
    body.onclick = async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const row = b.closest('[data-pid]');
      const pid = row.dataset.pid;
      try {
        if (b.dataset.act === 'replace') {
          const rep = await pickReplacement(productById(pid));
          if (!rep) return;
          await adjustPendingItem(pid, 'replace', rep.id);
        } else if (b.dataset.act === 'remove') {
          if (!(await confirmDialog('Eliminar de la lista', `¿Quitamos «${productById(pid).name}» de la lista?`, 'Eliminar', 'danger'))) return;
          await adjustPendingItem(pid, 'remove');
        } else {
          await adjustPendingItem(pid, 'keep');
        }
        row.remove();
        broadcast('lists');
        if (!body.querySelector('[data-pid]')) {
          await api.rpc('review_changes', { p_change_ids: removedCount.ids, p_actor: S.me }).catch(() => {});
          closePanel();
          toast('Lista revisada.');
        }
      } catch (err) {
        $('#unavError').textContent = explainError(err);
      }
    };
  });
}

async function countUnreviewedRemovals() {
  try {
    const rows = await api.select('catalog_changes', (q) => q.in('change_type', ['possibly_removed', 'removed']).is('reviewed_at', null).eq('needs_review', true).limit(500), 'id');
    return { count: rows.length, ids: rows.map((r) => r.id) };
  } catch { return { count: 0, ids: [] }; }
}

/** Buscador para elegir un sustituto (primero los de la misma zona). */
export function pickReplacement(original) {
  return new Promise((resolve) => {
    const zid = zoneIdOf(original.id);
    const same = productsInZone(zid).filter((p) => p.id !== original.id);
    const all = [...S.products.values()].filter((p) => selectable(p) && p.id !== original.id);
    const body = openPanel(`Sustituir «${original.name}»`, `
      <input class="input" type="search" id="repQ" placeholder="🔎 Buscar un producto…" aria-label="Buscar sustituto" autocomplete="off">
      <div class="change-list" id="repList" style="margin-top:10px"></div>`, { onClose: () => resolve(null) });
    const list = $('#repList');
    const draw = () => {
      const q = norm($('#repQ').value);
      const src = q ? all.filter((p) => q.split(' ').every((w) => p._hay.includes(w))) : same;
      list.innerHTML = src.slice(0, 40).map((p) => `<button type="button" class="change" data-pick="${esc(p.id)}" style="text-align:left">${productImg(p)}<span class="ch-main"><b>${esc(p.name)}</b><small>${esc(p.format_label || '')}</small></span><span class="ch-side">${fmtEur(p.price)}</span></button>`).join('') || '<div class="empty-note">Sin resultados.</div>';
    };
    draw();
    let t;
    $('#repQ').addEventListener('input', () => { clearTimeout(t); t = setTimeout(draw, 250); });
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      const p = productById(b.dataset.pick);
      resolve(p);
      closePanel();
    });
  });
}
