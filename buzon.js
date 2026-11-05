/* =====================================================================
   HOGAR · BUZÓN DE SUGERENCIAS (menú inicial)
   · Archivo independiente: no toca nada de la discoteca. Añade un botón al menú
     «¿A qué rincón de casa quieres entrar?» y su ventana.
   · Datos en Supabase (proyecto de la biblioteca, tabla public.hogar_suggestions).
     Solo se leen directamente; escribir, aceptar, rechazar y borrar pasa por funciones
     del servidor, que son las que comprueban la contraseña (aquí no se guarda).
   · Sin librerías: peticiones fetch a la API REST con la publishable key.
   ===================================================================== */
(function () {
  'use strict';
  if (window.HogarBuzon) return;

  const SQL_FILE = 'sql/buzon_sugerencias.sql';
  const MAX = 2000;
  const st = { rows: [], open: null, loading: false, error: '', busy: false, cfg: null };
  const $ = (q, el = document) => el.querySelector(q);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v) => { try { return new Date(v).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }); } catch { return ''; } };

  /* ---------- Configuración: la misma del proyecto de la biblioteca ---------- */
  function loadConfig() {
    if (st.cfg) return Promise.resolve(st.cfg);
    const pick = () => {
      const c = window.LIBRERIA_SUPABASE;
      const key = c && (c.publishableKey || c.anonKey);
      if (c?.url && key) { st.cfg = { url: String(c.url).replace(/\/+$/, ''), key }; return st.cfg; }
      return null;
    };
    if (pick()) return Promise.resolve(st.cfg);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = './libros/supabase-config.js';
      s.onload = () => (pick() ? resolve(st.cfg) : reject(new Error('Falta la configuración de Supabase de la biblioteca.')));
      s.onerror = () => reject(new Error('No se pudo cargar la configuración (revisa la conexión).'));
      document.head.appendChild(s);
    });
  }

  async function request(path, { method = 'GET', body = null } = {}) {
    const cfg = await loadConfig();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let res;
    try {
      res = await fetch(`${cfg.url}/rest/v1/${path}`, {
        method,
        headers: { apikey: cfg.key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : null,
        cache: 'no-store',
        signal: ctrl.signal
      });
    } catch (e) {
      throw new Error(e?.name === 'AbortError' ? 'Supabase no ha respondido a tiempo. Inténtalo de nuevo.' : 'Sin conexión. El buzón necesita internet.');
    } finally { clearTimeout(timer); }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) {
      const msg = String(data?.message || '');
      if (res.status === 404 || data?.code === 'PGRST205' || data?.code === 'PGRST202' || data?.code === '42P01' || /does not exist|Could not find/i.test(msg)) {
        throw new Error(`El buzón todavía no está preparado en Supabase: hay que ejecutar ${SQL_FILE}.`);
      }
      throw new Error(msg || `Error ${res.status} al hablar con Supabase.`);
    }
    return data;
  }
  const rpc = async (name, args) => {
    const r = await request(`rpc/${name}`, { method: 'POST', body: args });
    if (r && r.ok === false) throw new Error(r.message || 'No se ha podido completar.');
    return r;
  };

  /* ---------- Estilos (prefijo bz- para no chocar con la discoteca) ---------- */
  function injectStyles() {
    if ($('#bzStyles')) return;
    const css = `
.bz-open{appearance:none;-webkit-appearance:none;display:flex;align-items:center;gap:14px;width:100%;max-width:100%;margin:20px 0 0;padding:15px 20px;border:1px dashed #d9c9ae;border-radius:22px;background:#fffaf0;color:#243047;text-align:left;font:inherit;cursor:pointer;box-shadow:0 6px 18px #4b3b2612;transition:transform .18s}
.bz-open:hover{transform:translateY(-2px)}
.bz-open .bz-ico{display:grid;place-items:center;flex:0 0 auto;width:52px;height:52px;border-radius:16px;font-size:28px;background:linear-gradient(135deg,#9ad1ff,#ffd166)}
.bz-open b{display:block;font-size:18px}
.bz-open small{display:block;color:#687086;font-size:13px;margin-top:2px}
.bz-open .bz-count{margin-left:auto;flex:0 0 auto;min-width:28px;height:28px;padding:0 8px;border-radius:999px;background:#ff786b;color:#fff;font-weight:900;display:grid;place-items:center;font-size:14px}
.bz-open .bz-count[hidden]{display:none}
#buzon{position:fixed;inset:0;z-index:2000;display:none;background:#24304766;padding:18px;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
#buzon.open{display:block}
#buzon *{box-sizing:border-box}
#buzon .bz-box{position:relative;width:min(640px,100%);margin:0 auto;background:#fffdf8;border-radius:26px;padding:22px 20px 24px;box-shadow:0 20px 50px #0003;color:#243047;font:16px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:left}
#buzon h2{margin:0 52px 4px 0;font-size:clamp(24px,5vw,32px);line-height:1.1}
#buzon .bz-sub{margin:0 0 16px;color:#687086}
#buzon .bz-x{position:absolute;right:14px;top:14px;width:44px;height:44px;border:0;border-radius:14px;background:#fff4db;font-size:22px;font-weight:900;color:#243047;cursor:pointer}
#buzon section{background:#fff;border:1px solid #e9dfcf;border-radius:20px;padding:16px;margin-top:14px}
#buzon h3{margin:0 0 10px;font-size:18px;display:flex;align-items:center;gap:8px}
#buzon h3 small{margin-left:auto;color:#687086;font-size:13px;font-weight:800}
#buzon textarea{display:block;width:100%;min-height:110px;resize:vertical;border:1px solid #ded6ca;border-radius:14px;padding:12px 14px;font:inherit;font-size:16px;background:#fff;color:#243047}
#buzon textarea:focus,#buzon input:focus{outline:0;border-color:#ff786b;box-shadow:0 0 0 3px #ff786b22}
#buzon .bz-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px}
#buzon .bz-left{color:#687086;font-size:13px;margin-right:auto}
#buzon .bz-btn{appearance:none;-webkit-appearance:none;border:0;border-radius:13px;padding:11px 15px;min-height:44px;font:inherit;font-weight:900;cursor:pointer;background:#fff4db;color:#243047}
#buzon .bz-btn.primary{background:#ff786b;color:#fff}
#buzon .bz-btn.ok{background:#2f9e6f;color:#fff}
#buzon .bz-btn.no{background:#d9534f;color:#fff}
#buzon .bz-btn.grey{background:#eef0f4;color:#243047}
#buzon .bz-btn:disabled{opacity:.55;cursor:default}
#buzon .bz-list{display:grid;gap:8px}
#buzon .bz-item{border-radius:15px;background:#faf7f1;border:2px solid transparent}
#buzon .bz-item.accepted{background:#e6f6ee;border-color:#9fd8bb}
#buzon .bz-item.rejected{background:#fdeaea;border-color:#efb1ae}
#buzon .bz-head{appearance:none;-webkit-appearance:none;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;width:100%;border:0;background:transparent;padding:12px 14px;text-align:left;font:inherit;color:inherit;cursor:pointer}
#buzon .bz-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:750}
#buzon .bz-item.is-open .bz-text{white-space:pre-wrap;overflow-wrap:anywhere}
#buzon .bz-meta{color:#687086;font-size:12px;font-weight:800;white-space:nowrap}
#buzon .bz-head>span:first-child{display:grid;gap:3px;min-width:0}
#buzon .bz-state{display:block;font-size:13px;font-weight:900}
#buzon .accepted .bz-state{color:#1f7a52}
#buzon .rejected .bz-state{color:#b23b36}
#buzon .bz-actions{display:flex;flex-wrap:wrap;gap:8px;padding:0 14px 14px}
#buzon .bz-empty{background:#faf7f1;color:#687086;border-radius:14px;padding:14px;text-align:center}
#buzon .bz-msg{margin:10px 0 0;font-weight:800;font-size:14px;min-height:1.2em}
#buzon .bz-msg.err{color:#c0392b}
#buzon .bz-msg.okm{color:#1f7a52}
#buzon .bz-error{background:#fff1e6;border-radius:14px;padding:12px 14px;color:#8a4b12;font-weight:800;margin-top:12px}
#buzon .bz-ask{position:fixed;inset:0;z-index:2100;display:grid;place-items:center;background:#2430477a;padding:18px}
#buzon .bz-ask[hidden]{display:none}
#buzon .bz-ask-box{width:min(380px,100%);background:#fff;border-radius:22px;padding:20px;box-shadow:0 20px 50px #0004;text-align:center}
#buzon .bz-ask-box h4{margin:0 0 6px;font-size:20px}
#buzon .bz-ask-box p{margin:0 0 12px;color:#687086}
#buzon .bz-ask-box input{width:100%;border:1px solid #ded6ca;border-radius:13px;padding:12px;font:inherit;font-size:22px;text-align:center;letter-spacing:6px;margin-bottom:6px}
#buzon .bz-ask-box .bz-row{justify-content:center}
html.bz-locked,html.bz-locked body{overflow:hidden!important}
@media(max-width:650px){.bz-open{margin-top:14px;padding:12px 14px}.bz-open .bz-ico{width:44px;height:44px;font-size:24px}#buzon{padding:10px}#buzon .bz-box{padding:18px 14px 20px;border-radius:22px}#buzon .bz-actions .bz-btn{flex:1 1 30%}}`;
    const el = document.createElement('style');
    el.id = 'bzStyles';
    el.textContent = css;
    document.head.appendChild(el);
  }

  /* ---------- Ventana ---------- */
  function buildModal() {
    if ($('#buzon')) return;
    const m = document.createElement('div');
    m.id = 'buzon';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-labelledby', 'bzTitle');
    m.innerHTML = `<div class="bz-box">
      <button type="button" class="bz-x" data-bz-close aria-label="Cerrar el buzón">✕</button>
      <h2 id="bzTitle">📮 Buzón de sugerencias</h2>
      <p class="bz-sub">¿Qué te gustaría que tuviera Hogar? Cualquiera puede escribir una idea.</p>
      <section aria-labelledby="bzH1">
        <h3 id="bzH1">✍️ Nueva sugerencia</h3>
        <textarea id="bzBody" maxlength="${MAX}" placeholder="Escribe aquí tu idea para la discoteca, la biblioteca, la despensa…" aria-label="Tu sugerencia"></textarea>
        <div class="bz-row"><span class="bz-left" id="bzChars">0 / ${MAX}</span><button type="button" class="bz-btn primary" id="bzSend">📨 Enviar sugerencia</button></div>
        <p class="bz-msg" id="bzMsg" role="status" aria-live="polite"></p>
      </section>
      <section aria-labelledby="bzH2">
        <h3 id="bzH2">⏳ Pendientes <small id="bzPendCount"></small></h3>
        <div class="bz-list" id="bzPending"></div>
      </section>
      <section aria-labelledby="bzH3">
        <h3 id="bzH3">📬 Resueltas <small id="bzDoneCount"></small></h3>
        <div class="bz-list" id="bzDone"></div>
      </section>
      <div class="bz-ask" id="bzAsk" hidden>
        <div class="bz-ask-box" role="alertdialog" aria-modal="true" aria-labelledby="bzAskTitle">
          <h4 id="bzAskTitle"></h4>
          <p id="bzAskText"></p>
          <input id="bzAskPin" type="password" inputmode="numeric" autocomplete="off" aria-label="Contraseña" maxlength="12">
          <p class="bz-msg err" id="bzAskErr" role="alert"></p>
          <div class="bz-row" id="bzAskBtns"></div>
        </div>
      </div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', onClick);
    // En el documento: tras repintar, el foco puede haber quedado fuera de la ventana.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !m.classList.contains('open')) return;
      e.preventDefault();
      if (!$('#bzAsk').hidden) closeAsk(null); else closeBuzon();
    });
    const body = $('#bzBody');
    body.addEventListener('input', () => { $('#bzChars').textContent = `${body.value.length} / ${MAX}`; setMsg(''); });
    $('#bzSend').addEventListener('click', send);
  }

  function addButton() {
    const box = $('#homePicker .home-picker-box');
    if (!box || $('#bzOpen')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bz-open';
    b.id = 'bzOpen';
    b.innerHTML = '<span class="bz-ico" aria-hidden="true">📮</span><span><b>Buzón de sugerencias</b><small>¿Qué te gustaría que tuviera Hogar?</small></span><span class="bz-count" id="bzOpenCount" hidden></span>';
    b.addEventListener('click', openBuzon);
    box.appendChild(b);
  }

  let lastFocus = null;
  function openBuzon() {
    injectStyles();
    buildModal();
    lastFocus = document.activeElement;
    $('#buzon').classList.add('open');
    document.documentElement.classList.add('bz-locked');
    setMsg('');
    paint();
    refresh();
    setTimeout(() => $('#bzBody')?.focus({ preventScroll: true }), 60);
  }
  function closeBuzon() {
    $('#buzon')?.classList.remove('open');
    document.documentElement.classList.remove('bz-locked');
    closeAsk(null);
    lastFocus?.focus?.();
  }

  async function refresh() {
    st.loading = true;
    st.error = '';
    paint();
    try {
      const rows = await request('hogar_suggestions?select=id,body,status,created_at,resolved_at&order=created_at.desc');
      st.rows = Array.isArray(rows) ? rows : [];
    } catch (e) { st.error = e.message; }
    st.loading = false;
    paint();
  }

  function itemHtml(r) {
    const open = st.open === r.id;
    const done = r.status !== 'pending';
    const state = r.status === 'accepted' ? '✅ Aceptada · ya está en Hogar' : r.status === 'rejected' ? '❌ Rechazada' : '';
    const actions = !open ? '' : done
      ? `<div class="bz-actions"><button type="button" class="bz-btn grey" data-bz-del="${esc(r.id)}">🗑 Eliminar (con contraseña)</button></div>`
      : `<div class="bz-actions">
          <button type="button" class="bz-btn ok" data-bz-accept="${esc(r.id)}">✅ Aceptar</button>
          <button type="button" class="bz-btn no" data-bz-reject="${esc(r.id)}">❌ Rechazar</button>
          <button type="button" class="bz-btn grey" data-bz-del="${esc(r.id)}">🗑 Eliminar</button>
        </div>`;
    return `<div class="bz-item ${esc(r.status)}${open ? ' is-open' : ''}">
      <button type="button" class="bz-head" data-bz-toggle="${esc(r.id)}" aria-expanded="${open}">
        <span><span class="bz-text">${esc(r.body)}</span>${state ? `<span class="bz-state">${state}</span>` : ''}</span>
        <span class="bz-meta">${esc(fmt(done ? r.resolved_at || r.created_at : r.created_at))} ${open ? '▲' : '▼'}</span>
      </button>${actions}
    </div>`;
  }

  function paint() {
    const pend = st.rows.filter((r) => r.status === 'pending');
    const done = st.rows.filter((r) => r.status !== 'pending').sort((a, b) => String(b.resolved_at || '').localeCompare(String(a.resolved_at || '')));
    const count = $('#bzOpenCount');
    if (count) { count.hidden = !pend.length; count.textContent = String(pend.length); count.setAttribute('aria-label', `${pend.length} pendientes`); }
    if (!$('#buzon')) return;
    const wait = '<div class="bz-empty">Cargando…</div>';
    const err = st.error ? `<div class="bz-error">${esc(st.error)} <button type="button" class="bz-btn grey" data-bz-retry>Reintentar</button></div>` : '';
    $('#bzPendCount').textContent = st.rows.length || !st.loading ? `${pend.length}` : '';
    $('#bzDoneCount').textContent = st.rows.length || !st.loading ? `${done.length}` : '';
    $('#bzPending').innerHTML = err || (st.loading && !st.rows.length ? wait : pend.length ? pend.map(itemHtml).join('') : '<div class="bz-empty">No hay sugerencias esperando respuesta.</div>');
    $('#bzDone').innerHTML = st.error ? '' : st.loading && !st.rows.length ? wait : done.length ? done.map(itemHtml).join('') : '<div class="bz-empty">Todavía no hay sugerencias aceptadas ni rechazadas.</div>';
  }

  function setMsg(text, kind = 'okm') {
    const el = $('#bzMsg');
    if (!el) return;
    el.textContent = text;
    el.className = `bz-msg ${text ? kind : ''}`;
  }

  async function send() {
    const body = $('#bzBody');
    const txt = body.value.trim();
    if (txt.length < 3) { setMsg('Escribe un poco más (al menos 3 letras).', 'err'); body.focus(); return; }
    if (st.busy) return;
    st.busy = true;
    $('#bzSend').disabled = true;
    setMsg('Enviando…');
    try {
      const r = await rpc('hogar_suggestion_add', { p_body: txt });
      if (r?.row) st.rows = [r.row, ...st.rows.filter((x) => x.id !== r.row.id)];
      body.value = '';
      $('#bzChars').textContent = `0 / ${MAX}`;
      setMsg('¡Gracias! Tu sugerencia está en «Pendientes».');
      paint();
    } catch (e) { setMsg(e.message, 'err'); }
    st.busy = false;
    $('#bzSend').disabled = false;
  }

  /* ---------- Pregunta (contraseña o «¿seguro?») dentro del buzón ---------- */
  let askResolve = null;
  function ask({ title, text, pin = false, ok = 'Aceptar', kind = 'primary' }) {
    if (askResolve) askResolve(null);
    return new Promise((resolve) => {
      askResolve = resolve;
      $('#bzAskTitle').textContent = title;
      $('#bzAskText').textContent = text;
      const inp = $('#bzAskPin');
      inp.hidden = !pin;
      inp.value = '';
      $('#bzAskErr').textContent = '';
      $('#bzAskBtns').innerHTML = `<button type="button" class="bz-btn grey" data-bz-ask="no">Cancelar</button><button type="button" class="bz-btn ${esc(kind)}" data-bz-ask="yes">${esc(ok)}</button>`;
      $('#bzAsk').hidden = false;
      inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); answerAsk(true); } };
      setTimeout(() => (pin ? inp : $('#bzAskBtns [data-bz-ask="yes"]')).focus(), 40);
    });
  }
  function answerAsk(yes) {
    if (!yes) return closeAsk(null);
    const inp = $('#bzAskPin');
    if (!inp.hidden && !inp.value.trim()) { $('#bzAskErr').textContent = 'Escribe la contraseña.'; inp.focus(); return; }
    closeAsk(inp.hidden ? true : inp.value.trim());
  }
  function closeAsk(value) {
    const box = $('#bzAsk');
    if (box) box.hidden = true;
    const r = askResolve;
    askResolve = null;
    r?.(value);
  }

  async function act(fn, okText) {
    if (st.busy) return;
    st.busy = true;
    try {
      await fn();
      st.open = null;
      setMsg(okText);
      await refresh();
    } catch (e) { setMsg(e.message, 'err'); paint(); }
    st.busy = false;
  }

  async function resolveItem(id, status) {
    const pin = await ask({ title: status === 'accepted' ? '✅ Aceptar la sugerencia' : '❌ Rechazar la sugerencia', text: status === 'accepted' ? 'Aceptarla significa que ya está metida en Hogar. Escribe la contraseña:' : 'Escribe la contraseña para rechazarla:', pin: true, ok: status === 'accepted' ? 'Aceptar' : 'Rechazar', kind: status === 'accepted' ? 'ok' : 'no' });
    if (!pin) return;
    await act(() => rpc('hogar_suggestion_resolve', { p_id: id, p_status: status, p_pin: pin }), status === 'accepted' ? 'Sugerencia aceptada.' : 'Sugerencia rechazada.');
  }
  async function deleteItem(id) {
    const r = st.rows.find((x) => x.id === id);
    if (!r) return;
    const resolved = r.status !== 'pending';
    const answer = resolved
      ? await ask({ title: '🗑 Eliminar la sugerencia', text: 'Para borrar una sugerencia resuelta hace falta la contraseña:', pin: true, ok: 'Eliminar', kind: 'no' })
      : await ask({ title: '¿Seguro?', text: 'La sugerencia se borrará para siempre.', ok: 'Sí, eliminar', kind: 'no' });
    if (!answer) return;
    await act(() => rpc('hogar_suggestion_delete', { p_id: id, p_pin: resolved ? answer : null }), 'Sugerencia eliminada.');
  }

  function onClick(e) {
    const t = e.target;
    if (e.target.id === 'buzon' || t.closest('[data-bz-close]')) return closeBuzon();
    if (t.id === 'bzAsk') return closeAsk(null);
    const a = t.closest('[data-bz-ask]');
    if (a) return answerAsk(a.dataset.bzAsk === 'yes');
    if (t.closest('[data-bz-retry]')) return refresh();
    const tg = t.closest('[data-bz-toggle]');
    if (tg) { st.open = st.open === tg.dataset.bzToggle ? null : tg.dataset.bzToggle; paint(); return; }
    const ac = t.closest('[data-bz-accept]');
    if (ac) return resolveItem(ac.dataset.bzAccept, 'accepted');
    const rj = t.closest('[data-bz-reject]');
    if (rj) return resolveItem(rj.dataset.bzReject, 'rejected');
    const dl = t.closest('[data-bz-del]');
    if (dl) deleteItem(dl.dataset.bzDel);
  }

  function init() {
    injectStyles();
    addButton();
    // Contador de pendientes en el botón (en silencio: si falla, el botón funciona igual).
    request('hogar_suggestions?select=id,status&status=eq.pending').then((rows) => {
      if (Array.isArray(rows) && !st.rows.length) {
        const c = $('#bzOpenCount');
        if (c) { c.hidden = !rows.length; c.textContent = String(rows.length); }
      }
    }).catch(() => {});
  }

  window.HogarBuzon = { open: openBuzon, close: closeBuzon };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
