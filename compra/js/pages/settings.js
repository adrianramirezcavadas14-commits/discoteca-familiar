/* =====================================================================
   «Los ajustes» · Persona, clave, catálogo, categorías, zonas y datos
   ===================================================================== */
import { S, setMe, setFamilyKey, setSetting, updateZone, zonesByRoute, queueInfo, processQueue, discardFailedOps, clearLocal } from '../data/store.js';
import { api, explainError } from '../data/api.js';
import { idb } from '../data/idb.js';
import { manualSync, syncStatusText, syncRunning } from '../ui/sync.js';
import { toast, dialog, confirmDialog } from '../ui/dom.js';
import { broadcast } from '../ui/nav.js';
import { describeOp } from '../core/queue.js';
import { esc, plural, collator } from '../core/text.js';
import { SHOPPERS, APP_VERSION } from '../config.js';

export function render(el) {
  const sections = sectionList();
  const hidden = new Set((S.settings.hidden_category_ids || [24, 25]).map(Number));
  const confirmIds = new Set((S.settings.manual_confirm_category_ids || []).map(Number));
  const q = queueInfo();
  el.innerHTML = `
    <div class="hero"><div><h2 id="h-ajustes">Los ajustes</h2><p>Lo que casi nunca hay que tocar, pero conviene tener a mano.</p></div></div>
    <div class="settings-grid">
      <article class="card">
        <h3>¿Quién usa este dispositivo?</h3>
        <p class="muted">Se guarda quién hace cada cambio (zonas, tickets, listas).</p>
        <div class="who-pick" role="group" aria-label="Persona de este dispositivo">${SHOPPERS.map((s) => `<button type="button" data-me="${s.code}" style="--pc:${s.color}" aria-pressed="${S.me === s.code}">${esc(s.name)}</button>`).join('')}</div>
      </article>

      <article class="card">
        <h3>Clave familiar (opcional)</h3>
        <p class="muted">${api.key ? 'Hay una clave guardada en este dispositivo.' : 'La despensa se abre sin clave, igual que la discoteca y la biblioteca.'} ${S.household ? `Familia: <b>${esc(S.household.name)}</b>.` : ''}</p>
        ${api.key ? '<div class="row"><button type="button" class="btn ghost" data-key>Cambiar la clave</button><button type="button" class="btn ghost" data-forget>Olvidarla aquí</button></div>' : ''}
      </article>

      <article class="card">
        <h3>Catálogo del súper</h3>
        <p>${esc(syncStatusText())}</p>
        ${S.sync.last ? `<p class="muted" style="font-size:14px">Fuente: ${esc(S.sync.last.provider || '—')} · ${S.sync.last.products_seen || 0} productos. Se comprueba al entrar y se actualiza si han pasado ${S.sync.intervalHours || 12} h.</p>` : ''}
        <div class="row"><button type="button" class="btn primary" data-sync ${syncRunning() ? 'disabled' : ''}>🔄 Actualizar ahora</button><a class="btn ghost" href="#novedades">Ver el registro</a></div>
        <div class="form-grid" style="margin-top:12px">
          <label class="field"><span>Código postal del súper</span><input data-pc inputmode="numeric" maxlength="5" pattern="[0-9]{5}" value="${esc(S.store?.postal_code || '')}" placeholder="28300" autocomplete="postal-code"><small>Para recibir el surtido y los precios de esa zona.</small></label>
          <label class="field"><span>Actualizar cada (horas)</span><input data-hours type="number" min="12" max="168" step="1" value="${esc(S.settings.sync_interval_hours ?? 12)}"><small>Mínimo 12 horas.</small></label>
        </div>
        <div class="row end"><button type="button" class="btn small ghost" data-save-sync>Guardar</button></div>
        <p class="muted" style="font-size:12px">El catálogo procede de la tienda online de Mercadona (API pública no oficial) o, si falla, de la copia semanal de datania/mercadona-catalog. Esta aplicación es familiar y no está relacionada con Mercadona.</p>
      </article>

      <article class="card">
        <h3>Categorías del catálogo</h3>
        <p class="muted">Las ocultas se guardan pero no aparecen en el mapa, el buscador, la lista ni la ruta. «Preguntar zona» pide confirmar la zona de sus productos nuevos.</p>
        <div class="toggle-list" style="max-height:420px;overflow:auto">${sections.length ? sections.map((s) => `
          <div class="toggle-row"><span><b>${esc(s.name)}</b> <small class="muted">${plural(s.count, 'producto', 'productos')}</small></span>
            <span class="row" style="gap:12px"><label class="check"><input type="checkbox" data-hide="${s.id}" data-name="${esc(s.name)}" ${hidden.has(s.id) ? 'checked' : ''}> Ocultar</label>
            <label class="check"><input type="checkbox" data-ask="${s.id}" ${confirmIds.has(s.id) ? 'checked' : ''}> Preguntar zona</label></span></div>`).join('') : '<div class="empty-note">El catálogo todavía no se ha descargado.</div>'}</div>
        <div class="row end" style="margin-top:10px"><button type="button" class="btn small primary" data-save-cats>Guardar categorías</button></div>
      </article>

      <article class="card" style="grid-column:1 / -1">
        <h3>Las zonas del súper</h3>
        <p class="muted">Nombre visible, resumen que sale en las flechas, observaciones (aparecen al ampliar un producto en la compra) y si la zona está activa.</p>
        <div class="stack">${zonesByRoute().map((z) => `
          <div class="zone-edit" style="--zc:${esc(z.color)}" data-zone-edit="${esc(z.id)}">
            <span class="zn">${z.route_order}</span>
            <div class="form-grid">
              <label class="field"><span>Nombre</span><input data-zf="name" value="${esc(z.name)}" maxlength="60"></label>
              <label class="field"><span>Resumen de categorías</span><input data-zf="summary" value="${esc(z.summary || '')}" maxlength="200"></label>
              <label class="field span2"><span>Observaciones</span><input data-zf="notes" value="${esc(z.notes || '')}" maxlength="500"></label>
              <label class="check"><input type="checkbox" data-zf="active" ${z.active !== false ? 'checked' : ''}> Zona activa</label>
              <div class="row end"><button type="button" class="btn small ghost" data-save-zone>Guardar zona ${z.route_order}</button></div>
            </div>
          </div>`).join('')}</div>
      </article>

      <article class="card" style="grid-column:1 / -1">
        <h3>Datos de este dispositivo</h3>
        <p class="muted">Almacenamiento: ${idb.inMemory ? 'memoria (este navegador no permite guardar datos)' : 'IndexedDB'} · ${S.products.size} productos guardados para usar sin conexión.</p>
        ${q.items.length ? `<ul>${q.items.map((o) => `<li>${esc(describeOp(o))}${o.failed ? ` — <b style="color:#9a2c23">no aplicado: ${esc(o.lastError || '')}</b>` : ` — pendiente de enviar${o.lastError ? ` (${esc(o.lastError)})` : ''}`}</li>`).join('')}</ul>` : '<p>✓ No hay cambios pendientes de enviar.</p>'}
        <div class="row">
          <button type="button" class="btn ghost" data-flush ${q.pending ? '' : 'disabled'}>Enviar ahora</button>
          ${q.failed.length ? '<button type="button" class="btn ghost" data-discard>Descartar lo no aplicado</button>' : ''}
          <button type="button" class="btn ghost" data-clear>Borrar los datos guardados aquí</button>
        </div>
        <p class="muted" style="font-size:12px;margin-top:12px">Versión ${esc(APP_VERSION)} · dispositivo ${esc((S.deviceId || '').slice(0, 8))}</p>
      </article>
    </div>`;
  el.onclick = (e) => onClick(e, el);
}
export function update(el, params, what) { if (['sync', 'queue', 'settings', 'zones', 'me'].includes(what)) render(el); }

function sectionList() {
  const m = new Map();
  for (const p of S.products.values()) {
    if (p.category_id == null) continue;
    const cur = m.get(p.category_id) || { id: p.category_id, name: p.category_name || String(p.category_id), count: 0 };
    cur.count++;
    m.set(p.category_id, cur);
  }
  return [...m.values()].sort((a, b) => collator.compare(a.name, b.name));
}

async function onClick(e, el) {
  const t = e.target;
  const me = t.closest('[data-me]');
  if (me) { setMe(me.dataset.me); toast(`Este dispositivo es de ${SHOPPERS.find((s) => s.code === me.dataset.me).name}.`); return; }
  if (t.closest('[data-key]')) {
    const r = await dialog({ title: 'Cambiar la clave familiar', message: 'Escribe la clave nueva (la que se configuró en Supabase).', input: { type: 'password', label: 'Clave familiar' }, buttons: [{ label: 'Cancelar', value: false }, { label: 'Guardar y recargar', value: true, kind: 'primary' }] });
    if (r.value && String(r.input || '').trim().length >= 8) { setFamilyKey(r.input); location.reload(); }
    return;
  }
  if (t.closest('[data-forget]')) {
    if (await confirmDialog('Olvidar la clave', 'Este dispositivo dejará de entrar en la despensa hasta que se vuelva a escribir la clave.', 'Olvidar', 'danger')) { setFamilyKey(null); location.reload(); }
    return;
  }
  if (t.closest('[data-sync]')) { await manualSync(); render(el); return; }
  if (t.closest('[data-save-sync]')) {
    const pc = el.querySelector('[data-pc]').value.trim();
    const hours = Number(el.querySelector('[data-hours]').value);
    try {
      if (pc !== (S.store?.postal_code || '')) {
        if (pc && !/^\d{5}$/.test(pc)) { toast('El código postal tiene 5 cifras.'); return; }
        await setSetting('postal_code', pc || null);
        S.store = { ...S.store, postal_code: pc || null, warehouse_code: null };
      }
      if (hours !== Number(S.settings.sync_interval_hours ?? 12)) await setSetting('sync_interval_hours', hours);
      toast('Ajustes del catálogo guardados.');
    } catch (err) { dialog({ title: 'No se ha guardado', message: explainError(err) }); }
    return;
  }
  if (t.closest('[data-save-cats]')) {
    const hide = [...el.querySelectorAll('[data-hide]')].filter((c) => c.checked);
    const ask = [...el.querySelectorAll('[data-ask]')].filter((c) => c.checked).map((c) => Number(c.dataset.ask));
    try {
      await setSetting('hidden_category_ids', hide.map((c) => Number(c.dataset.hide)));
      await setSetting('hidden_category_names', hide.map((c) => c.dataset.name));
      await setSetting('manual_confirm_category_ids', ask);
      broadcast('catalog');
      toast('Categorías guardadas.');
    } catch (err) { dialog({ title: 'No se ha guardado', message: explainError(err) }); }
    return;
  }
  const zb = t.closest('[data-save-zone]');
  if (zb) {
    const box = zb.closest('[data-zone-edit]');
    const z = S.zones.find((x) => x.id === box.dataset.zoneEdit);
    const v = (k) => box.querySelector(`[data-zf="${k}"]`);
    try {
      await updateZone(z, { name: v('name').value.trim(), summary: v('summary').value.trim(), notes: v('notes').value.trim(), active: v('active').checked });
      broadcast('zones');
      toast(`Zona ${z.route_order} guardada.`);
    } catch (err) { dialog({ title: 'No se ha guardado', message: explainError(err) }); }
    return;
  }
  if (t.closest('[data-flush]')) { await processQueue(); render(el); toast(queueInfo().pending ? 'Sigue sin conexión: se enviará más tarde.' : 'Todo enviado.'); return; }
  if (t.closest('[data-discard]')) {
    if (await confirmDialog('Descartar cambios no aplicados', 'Se quitarán de la cola los cambios que el servidor rechazó.', 'Descartar', 'danger')) { await discardFailedOps(); render(el); }
    return;
  }
  if (t.closest('[data-clear]')) {
    const q = queueInfo();
    if (!(await confirmDialog('Borrar los datos guardados aquí', `${q.pending ? `⚠️ Hay ${plural(q.pending, 'cambio', 'cambios')} sin enviar que se perderán. ` : ''}Se borrará la copia local (catálogo, listas y miniaturas) y se volverá a descargar.`, 'Borrar y recargar', 'danger'))) return;
    await clearLocal();
    location.reload();
  }
}
