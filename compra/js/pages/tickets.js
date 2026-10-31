/* =====================================================================
   «Tickets por saldar» · Tickets de compra pendientes de pago
   Los archivos van a un bucket PRIVADO a través de la función
   «compra-tickets»; para verlos se pide una URL firmada de 5 minutos.
   ===================================================================== */
import { S, profileName } from '../data/store.js';
import { api, explainError } from '../data/api.js';
import { openPanel, closePanel } from '../ui/cards.js';
import { toast, dialog, confirmDialog, withLoader } from '../ui/dom.js';
import { broadcast, askWho } from '../ui/nav.js';
import { esc, fmtEur, fmtDate, fmtDateTime, fmtDuration, todayISO } from '../core/text.js';
import { SHOPPERS, MAX_TICKET_MB } from '../config.js';

const ui = { tab: 'pending', receipts: [], sessions: [], loaded: false, loading: false, error: '' };
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

async function load(el) {
  if (ui.loading || !api.ready) return;
  ui.loading = true;
  try {
    const [receipts, sessions] = await Promise.all([
      api.select('purchase_receipts', (q) => q.order('created_at', { ascending: false }).limit(300)),
      api.select('shopping_sessions', (q) => q.eq('status', 'completed').order('ended_at', { ascending: false }).limit(40), 'id,shopper_profile_id,ended_at,duration_seconds,final_estimated_total')
    ]);
    Object.assign(ui, { receipts, sessions, loaded: true, error: '' });
  } catch (e) {
    ui.error = explainError(e);
  } finally {
    ui.loading = false;
    if (el.classList.contains('active')) paint(el);
  }
}

export function render(el) {
  el.innerHTML = `<div class="hero"><div><h2 id="h-tickets">Tickets por saldar</h2><p>Sube el ticket de la compra y marca quién lo ha pagado.</p></div>
    <button type="button" class="btn primary" data-upload>📷 Subir un ticket</button></div><div data-body></div>`;
  el.onclick = (e) => onClick(e, el);
  paint(el);
  load(el);
}
export function update(el, params, what) { if (what === 'receipts') load(el); }

const sessionLabel = (id) => {
  const s = ui.sessions.find((x) => x.id === id);
  return s ? `Compra del ${fmtDate(s.ended_at)} · ${profileName(s.shopper_profile_id)}` : '';
};

function paint(el) {
  const body = el.querySelector('[data-body]');
  const pending = ui.receipts.filter((r) => r.status === 'pending');
  const paid = ui.receipts.filter((r) => r.status === 'paid');
  const list = ui.tab === 'pending' ? pending : paid;
  body.innerHTML = `
    <div class="tabs" role="tablist" aria-label="Tickets">
      <button type="button" class="tab" role="tab" data-tab="pending" aria-selected="${ui.tab === 'pending'}">Pendientes<span class="count">${pending.length}</span></button>
      <button type="button" class="tab" role="tab" data-tab="paid" aria-selected="${ui.tab === 'paid'}">Historial<span class="count">${paid.length}</span></button>
    </div>
    ${ui.error ? `<div class="offline-banner">${esc(ui.error)}</div>` : ''}
    ${!ui.loaded && !ui.error ? '<div class="empty-note">Cargando tickets…</div>' : ''}
    ${ui.loaded && !list.length ? `<div class="empty-note">${ui.tab === 'pending' ? 'No hay tickets pendientes de pago. 🎉' : 'Todavía no hay tickets pagados.'}</div>` : ''}
    <div class="ticket-list" role="tabpanel">${list.map(ticketHtml).join('')}</div>`;
}

function ticketHtml(r) {
  const pdf = r.mime_type === 'application/pdf';
  return `<article class="ticket" data-id="${esc(r.id)}">
    <button type="button" class="t-icon" data-view aria-label="Ver el ticket">${pdf ? '📄' : '🧾'}</button>
    <div class="t-main">
      <b>${r.amount != null ? fmtEur(r.amount) : 'Importe sin indicar'}</b>
      <small>${r.paid_by ? `Lo pagó ${esc(profileName(r.paid_by))}` : 'Sin indicar quién pagó'} · ${esc(fmtDate(r.receipt_date || r.created_at))}</small>
      ${r.session_id ? `<small>${esc(sessionLabel(r.session_id))}</small>` : ''}
      ${r.notes ? `<small>📝 ${esc(r.notes)}</small>` : ''}
      ${r.status === 'paid' ? `<small>✅ Marcado como pagado por ${esc(profileName(r.marked_paid_by))} el ${esc(fmtDateTime(r.marked_paid_at))}</small>` : ''}
    </div>
    <div class="t-actions">
      <button type="button" class="btn small ghost" data-view>Ver</button>
      <button type="button" class="btn small ghost" data-edit>Editar</button>
      ${r.status === 'pending' ? '<button type="button" class="paid-btn" data-paid aria-label="Marcar como pagado">✓ Pagado</button>' : ''}
      <button type="button" class="btn small ghost" data-del aria-label="Eliminar ticket">🗑</button>
    </div>
  </article>`;
}

async function onClick(e, el) {
  const t = e.target;
  if (t.closest('[data-upload]')) { uploadForm(el); return; }
  const tab = t.closest('[data-tab]');
  if (tab) { ui.tab = tab.dataset.tab; paint(el); return; }
  const card = t.closest('[data-id]');
  if (!card) return;
  const r = ui.receipts.find((x) => x.id === card.dataset.id);
  if (t.closest('[data-view]')) return view(r);
  if (t.closest('[data-edit]')) return editForm(r, el);
  if (t.closest('[data-paid]')) return markPaid(r, el);
  if (t.closest('[data-del]')) return remove(r, el);
}

async function view(r) {
  // La ventana se abre en el mismo toque (si no, el navegador la bloquea) y se rellena al tener la URL firmada.
  const w = window.open('about:blank', '_blank');
  if (w) { try { w.opener = null; w.document.title = 'Ticket'; w.document.body.textContent = 'Abriendo el ticket…'; } catch { /* nada */ } }
  try {
    const res = await api.tickets({ action: 'signed-url', receipt_id: r.id });
    if (w) w.location.href = res.url; else window.location.assign(res.url);
  } catch (e) {
    w?.close();
    dialog({ title: 'No se puede abrir el ticket', message: explainError(e) });
  }
}

async function markPaid(r, el) {
  const me = S.me || await askWho(true);
  if (!me) return;
  const who = SHOPPERS.find((s) => s.code === me)?.name || me;
  if (!(await confirmDialog('Marcar como pagado', `${who} confirma que el ticket de ${r.amount != null ? fmtEur(r.amount) : 'esta compra'} ya está pagado. Seguirá en el historial.`, '✓ Pagado'))) return;
  try {
    const row = await api.rpc('mark_receipt_paid', { p_receipt_id: r.id, p_actor: me });
    Object.assign(r, row);
    broadcast('receipts');
    toast('Ticket pagado. Lo tienes en el historial.');
    paint(el);
  } catch (e) { dialog({ title: 'No se ha podido marcar', message: explainError(e) }); }
}

async function remove(r, el) {
  if (!(await confirmDialog('Eliminar ticket', 'El ticket dejará de verse en la aplicación (se conserva un registro por seguridad). ¿Eliminar?', 'Eliminar', 'danger'))) return;
  try {
    await api.rpc('delete_receipt', { p_receipt_id: r.id, p_actor: S.me });
    ui.receipts = ui.receipts.filter((x) => x.id !== r.id);
    broadcast('receipts');
    paint(el);
  } catch (e) { dialog({ title: 'No se ha podido eliminar', message: explainError(e) }); }
}

function formFields(r = {}) {
  const sessions = ui.sessions.map((s) => `<option value="${esc(s.id)}"${r.session_id === s.id ? ' selected' : ''}>${esc(fmtDate(s.ended_at))} · ${esc(profileName(s.shopper_profile_id))} · ${fmtEur(s.final_estimated_total)} · ${esc(fmtDuration(s.duration_seconds))}</option>`).join('');
  const people = SHOPPERS.map((s) => `<option value="${s.code}"${(r.paid_by ? profileName(r.paid_by) === s.name : S.me === s.code) ? ' selected' : ''}>${s.name}</option>`).join('');
  return `<div class="form-grid">
    <label class="field span2"><span>Compra</span><select data-f="session"><option value="">Sin asociar</option>${sessions}</select><small>Solo compras finalizadas.</small></label>
    <label class="field"><span>¿Quién pagó?</span><select data-f="paid_by"><option value="">Sin indicar</option>${people}</select></label>
    <label class="field"><span>Importe (€)</span><input data-f="amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${r.amount != null ? String(r.amount).replace('.', ',') : ''}"></label>
    <label class="field"><span>Fecha</span><input data-f="date" type="date" value="${esc(r.receipt_date || todayISO())}"></label>
    <label class="field span2"><span>Observaciones</span><textarea data-f="notes" rows="2" maxlength="500">${esc(r.notes || '')}</textarea></label>
  </div>`;
}
const readAmount = (v) => {
  const s = String(v || '').trim().replace(/\s|€/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n < 100000 ? Math.round(n * 100) / 100 : NaN;
};

function uploadForm(el) {
  let file = null;
  const body = openPanel('Subir un ticket', `
    <div class="file-picks">
      <label class="btn yellow">📸 Hacer foto<input type="file" accept="image/*" capture="environment" data-file hidden></label>
      <label class="btn ghost">🖼️ Elegir imagen<input type="file" accept="image/*" data-file hidden></label>
      <label class="btn ghost">📄 Subir PDF<input type="file" accept="application/pdf" data-file hidden></label>
    </div>
    <div class="preview" data-preview><span class="muted">Vista previa del ticket</span></div>
    <div style="margin-top:12px">${formFields({})}</div>
    <p class="muted" style="font-size:13px">Formatos: JPG, PNG, WEBP, HEIC o PDF · máximo ${MAX_TICKET_MB} MB. Las fotos grandes se reducen antes de subirlas. La lectura automática (OCR) llegará más adelante; los datos siempre se pueden corregir a mano.</p>
    <div class="form-error" data-err role="alert"></div>
    <div class="row end"><button type="button" class="btn ghost" data-cancel>Cancelar</button><button type="button" class="btn primary" data-send disabled>Subir ticket</button></div>`);
  body.addEventListener('change', async (e) => {
    if (!e.target.matches('[data-file]')) return;
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const err = body.querySelector('[data-err]');
    err.textContent = '';
    if (!ACCEPT.includes(f.type) && !/\.(heic|heif)$/i.test(f.name)) { err.textContent = 'Formato no admitido. Usa una foto o un PDF.'; return; }
    file = await compressImage(f);
    if (file.size > MAX_TICKET_MB * 1024 * 1024) { err.textContent = `El archivo supera los ${MAX_TICKET_MB} MB.`; file = null; return; }
    const prev = body.querySelector('[data-preview]');
    if (file.type === 'application/pdf') prev.innerHTML = `<div class="pdf" aria-hidden="true">📄</div><b>${esc(file.name)}</b><small class="muted">${(file.size / 1024).toFixed(0)} KB</small>`;
    else if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)) prev.innerHTML = `<div class="pdf" aria-hidden="true">🖼️</div><b>${esc(file.name)}</b><small class="muted">Foto HEIC (sin vista previa en este navegador)</small>`;
    else { const url = URL.createObjectURL(file); prev.innerHTML = `<img src="${url}" alt="Vista previa del ticket">`; }
    body.querySelector('[data-send]').disabled = false;
  });
  body.addEventListener('click', async (e) => {
    if (e.target.closest('[data-cancel]')) { closePanel(); return; }
    if (!e.target.closest('[data-send]') || !file) return;
    const f = (k) => body.querySelector(`[data-f="${k}"]`).value;
    const amount = readAmount(f('amount'));
    if (Number.isNaN(amount)) { body.querySelector('[data-err]').textContent = 'Revisa el importe (por ejemplo 54,30).'; return; }
    const form = new FormData();
    form.append('action', 'upload');
    form.append('file', file, file.name);
    if (f('session')) form.append('session_id', f('session'));
    form.append('paid_by', f('paid_by'));
    if (amount != null) form.append('amount', String(amount));
    form.append('receipt_date', f('date'));
    form.append('notes', f('notes'));
    form.append('actor', S.me || '');
    closePanel();
    const res = await withLoader({ asset: 'saving', title: 'Guardando el ticket…', text: 'Subiéndolo a la carpeta privada de la familia', doneTitle: 'Ticket guardado', doneText: 'Ya aparece en pendientes.' },
      async (progress) => { progress(35, 'Comprobando el archivo y subiéndolo…'); const r = await api.tickets(form); progress(95); return r; }, explainError);
    if (res.ok) { ui.receipts.unshift(res.value.receipt); ui.tab = 'pending'; broadcast('receipts'); paint(el); }
  });
}

function editForm(r, el) {
  const body = openPanel('Editar ticket', `${formFields(r)}<div class="form-error" data-err role="alert"></div>
    <div class="row end"><button type="button" class="btn ghost" data-cancel>Cancelar</button><button type="button" class="btn primary" data-save>Guardar</button></div>`);
  body.onclick = async (e) => {
    if (e.target.closest('[data-cancel]')) { closePanel(); return; }
    if (!e.target.closest('[data-save]')) return;
    const f = (k) => body.querySelector(`[data-f="${k}"]`).value;
    const amount = readAmount(f('amount'));
    if (Number.isNaN(amount)) { body.querySelector('[data-err]').textContent = 'Revisa el importe.'; return; }
    try {
      const row = await api.rpc('update_receipt', { p_receipt_id: r.id, p_session_id: f('session') || null, p_paid_by: f('paid_by') || null, p_amount: amount, p_receipt_date: f('date') || null, p_notes: f('notes'), p_actor: S.me });
      Object.assign(r, row);
      closePanel();
      broadcast('receipts');
      paint(el);
      toast('Ticket actualizado.');
    } catch (err) { body.querySelector('[data-err]').textContent = explainError(err); }
  };
}

/** Reduce fotos grandes (máx. 2000 px, JPEG 82 %). PDF y HEIC se suben tal cual. */
async function compressImage(f) {
  if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size < 700 * 1024) return f;
  try {
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
    if (!blob || blob.size >= f.size) return f;
    return new File([blob], f.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return f; }
}
