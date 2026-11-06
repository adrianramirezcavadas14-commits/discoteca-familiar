/* =====================================================================
   NUESTRA DISCOTECA FAMILIAR · «Discos de viaje» y «Álbumes pendientes»
   · Archivo independiente: añade dos secciones al menú de la discoteca sin tocar
     su código. Lee la colección (DATA) solo para elegir discos.
   · Datos en Supabase, proyecto de la biblioteca (tablas disc_loans,
     disc_loan_requests, disc_pending y los nombres guardados de book_people).
     Cada fila guarda una copia del álbum, artista, formato, portada y dueños, así
     que se ve bien aunque el disco se edite después.
   · Sin librerías: peticiones fetch a la API REST con la publishable key.
   ===================================================================== */
(function () {
  'use strict';
  if (window.HogarDiscosExtra) return;

  const SQL_FILE = 'sql/discos_prestamos_y_pendientes.sql';
  const FAM = ['Papá', 'Mamá', 'María', 'Adrián'];
  const LIMIT = 5;
  const TB = { loans: 'disc_loans', requests: 'disc_loan_requests', pending: 'disc_pending', people: 'book_people' };
  const st = { loans: [], requests: [], pending: [], people: [], missing: false, error: '', loading: false, pendPerson: FAM[0], more: false, pick: { mode: null, person: null, owner: null }, cfg: null };

  const $ = (q, el = document) => el.querySelector(q);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nrm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); }));
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const fmtDate = (v) => { if (!v) return ''; const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : new Date(v); return Number.isNaN(+d) ? '' : d.toLocaleDateString('es-ES'); };
  const daysAgo = (v) => { const d = Math.max(0, Math.round((new Date(`${today()}T12:00:00`) - new Date(`${String(v).slice(0, 10)}T12:00:00`)) / 86400000)); return d === 0 ? 'hoy' : d === 1 ? 'hace 1 día' : `hace ${d} días`; };
  const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

  /* ---------- Datos de la discoteca (variables de su propio script) ---------- */
  // eslint-disable-next-line no-undef
  const discs = () => { try { return Array.isArray(DATA) ? DATA : []; } catch { return []; } };
  const ownersOf = (d) => [...new Set((d.owners && d.owners.length ? d.owners : [d.owner]).filter(Boolean))];
  const OTHER = ['#7b8db8', '#c98bb9', '#d39b5d', '#6aa7b8', '#9a8fd1', '#b7a05a'];
  function colorOf(name) {
    // eslint-disable-next-line no-undef
    try { if (typeof colors === 'object' && colors && colors[name]) return colors[name]; } catch { /* sin colores propios */ }
    const base = { Papá: '#ff786b', Mamá: '#66c9a7', María: '#6674c7', Adrián: '#e5a93d' };
    if (base[name]) return base[name];
    let h = 0;
    for (const ch of nrm(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return OTHER[h % OTHER.length];
  }
  /** Clave estable de un disco: álbum, artista, formato y dueños. */
  const discKey = (d) => [d.album, d.artist, d.category, ownersOf(d).slice().sort().join('+')].map(nrm).join('|').slice(0, 600);
  const discByKey = (k) => discs().find((d) => discKey(d) === k) || null;
  const coverOk = (u) => (/^https?:\/\//i.test(String(u || '')) && String(u).length <= 2000 ? String(u) : null);
  const snapshot = (d) => ({ disc_key: discKey(d), album: String(d.album || '').slice(0, 300), artist: String(d.artist || '').slice(0, 300), category: d.category ? String(d.category).slice(0, 40) : null, cover: coverOk(d.cover), owners: ownersOf(d) });

  function toast(msg, ms = 2600) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), ms);
  }

  /* ---------- Supabase (REST) ---------- */
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
      s.onload = () => (pick() ? resolve(st.cfg) : reject(new Error('Falta la configuración de Supabase.')));
      s.onerror = () => reject(new Error('No se pudo cargar la configuración (revisa la conexión).'));
      document.head.appendChild(s);
    });
  }
  class RestError extends Error { constructor(msg, extra = {}) { super(msg); Object.assign(this, extra); } }
  async function rest(path, { method = 'GET', body = null, prefer = null } = {}) {
    const cfg = await loadConfig();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let res;
    try {
      res = await fetch(`${cfg.url}/rest/v1/${path}`, {
        method,
        headers: { apikey: cfg.key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(prefer ? { Prefer: prefer } : {}) },
        body: body ? JSON.stringify(body) : null,
        cache: 'no-store',
        signal: ctrl.signal
      });
    } catch (e) {
      throw new RestError(e?.name === 'AbortError' ? 'Supabase no ha respondido a tiempo. Inténtalo de nuevo.' : 'Sin conexión: esta sección necesita internet.');
    } finally { clearTimeout(timer); }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) {
      const msg = String(data?.message || '');
      const missing = res.status === 404 || ['PGRST205', 'PGRST202', '42P01'].includes(data?.code) || /does not exist|Could not find/i.test(msg);
      if (missing) throw new RestError(`Falta preparar esta sección en Supabase: ejecuta ${SQL_FILE}.`, { missing: true });
      if (data?.code === '23505') throw new RestError('Ya estaba apuntado.', { duplicate: true });
      throw new RestError(msg || `Error ${res.status} al hablar con Supabase.`);
    }
    return data;
  }
  const selectAll = (t, order = 'created_at.asc') => rest(`${t}?select=*&order=${order}`);
  const insert = async (t, row) => (await rest(t, { method: 'POST', body: row, prefer: 'return=representation' }))?.[0] || row;
  const remove = (t, id) => rest(`${t}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });

  async function refresh(which = ['loans', 'requests', 'pending', 'people']) {
    st.loading = true;
    try {
      const got = await Promise.all(which.map((w) => selectAll(TB[w])));
      which.forEach((w, i) => { st[w] = Array.isArray(got[i]) ? got[i] : []; });
      st.error = '';
      st.missing = false;
    } catch (e) {
      st.error = e.message;
      st.missing = !!e.missing;
    }
    st.loading = false;
    paint();
  }

  /* ---------- Estilos ---------- */
  function injectStyles() {
    if ($('#dxStyles')) return;
    const el = document.createElement('style');
    el.id = 'dxStyles';
    el.textContent = `
.dx-btns{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;flex:0 0 auto}
.dx-btn{border:0;border-radius:13px;padding:11px 14px;min-height:44px;background:var(--yellow);color:#5b4720;font-weight:900;font:inherit;font-weight:900;cursor:pointer}
.dx-btn.alt{background:#efeafe;color:#4b3f8f}
.dx-btn.coral{background:var(--coral);color:#fff}
.dx-btn.mint{background:var(--mint);color:#fff}
.dx-btn.soft{background:#fff1ee;color:#a2412f}
.dx-btn.grey{background:#eef0f4;color:var(--ink)}
.dx-btn:disabled{opacity:.5;cursor:default}
.dx-sub{margin:26px 0 12px;font-size:20px;display:flex;align-items:center;gap:8px}
.dx-sub small{color:var(--muted);font-size:13px;font-weight:800}
.dx-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,360px),1fr));gap:16px}
.dx-card{background:#fff;border:1px solid var(--line);border-radius:22px;padding:16px;box-shadow:var(--shadow);display:grid;gap:12px;min-width:0}
.dx-card.req{border-style:dashed}
.dx-disc{display:grid;grid-template-columns:56px minmax(0,1fr);gap:11px;align-items:center;border:0;background:transparent;padding:0;text-align:left;color:inherit;font:inherit;min-width:0;cursor:pointer}
.dx-thumb{width:56px;height:56px;border-radius:12px;overflow:hidden;background:#f2ece2;display:grid;place-items:center;font-size:26px;flex:0 0 auto}
.dx-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.dx-title{display:grid;gap:2px;min-width:0}
.dx-title b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dx-title span{color:var(--muted);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dx-route{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:8px;background:#faf7f1;border-radius:16px;padding:12px 10px}
.dx-side{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0}
.dx-and{color:var(--muted);font-size:12px;font-weight:800}
.dx-who{display:inline-flex;align-items:center;gap:6px;max-width:100%;border-radius:999px;padding:6px 11px;background:#fff;border:2px solid var(--c,#ccc);font-weight:900;font-size:14px;white-space:nowrap}
.dx-who i{width:10px;height:10px;border-radius:4px;background:var(--c,#ccc);flex:0 0 auto}
.dx-who>span{min-width:0;overflow:hidden;text-overflow:ellipsis}
.dx-who.to{background:var(--c,#ccc);color:#fff}
.dx-who.to i{background:#fff}
.dx-arrow{position:relative;display:grid;place-items:center;width:56px;height:30px;font-size:16px}
.dx-arrow i{position:absolute;left:2px;right:8px;top:50%;height:3px;margin-top:-1.5px;border-radius:3px;background:repeating-linear-gradient(90deg,var(--coral) 0 8px,transparent 8px 13px);animation:dx-move 1.2s linear infinite}
.dx-arrow i::after{content:'';position:absolute;right:-9px;top:50%;margin-top:-7px;border:7px solid transparent;border-left:10px solid var(--coral);border-right:0}
.dx-arrow.ask i{background:repeating-linear-gradient(90deg,#9a8fd1 0 8px,transparent 8px 13px)}
.dx-arrow.ask i::after{border-left-color:#9a8fd1}
.dx-arrow span{position:relative}
@keyframes dx-move{from{background-position:0 0}to{background-position:13px 0}}
@media(prefers-reduced-motion:reduce){.dx-arrow i{animation:none}}
.dx-since{color:#8a7a62;font-size:12px;font-weight:800}
.dx-row2{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}
.dx-back{width:100%;font-size:16px}
.dx-empty{background:#f8f5ef;border-radius:15px;padding:16px;color:var(--muted);text-align:center}
.dx-note{background:#fff8e8;padding:18px;border-radius:15px;margin-top:16px;font-weight:700}
.dx-pend{margin-top:16px}
.dx-pend .wishlist-card-head{flex-wrap:wrap}
.dx-hint{margin:10px 0 0;color:var(--muted);font-size:13px}
.dx-items{display:grid;gap:9px;margin-top:14px}
.dx-item{display:grid;grid-template-columns:58px minmax(0,1fr) auto;gap:10px;align-items:center;width:100%;border:0;border-radius:14px;padding:8px;background:#f8f5ef;text-align:left;color:var(--ink);font:inherit;cursor:pointer}
.dx-item:hover{background:#efe8dc}
.dx-item .dx-thumb{width:58px;height:58px}
.dx-item small{display:block;font-size:12px;font-weight:800;color:#8a7a62;margin-top:2px}
.dx-item small .dx-by{color:var(--ink);font-weight:900}
.dx-item small .dx-by::before{content:'';display:inline-block;width:8px;height:8px;border-radius:3px;background:var(--c,#ccc);margin-right:4px}
.dx-item .dx-more-ico{font-size:22px;font-weight:900;padding:0 8px}
.dx-tag{display:inline-block;margin-top:3px;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:900;background:#fff3c4;color:#7a5a00}
.dx-tag.rec{background:#f3e8ff;color:#6b3fa0}
.dx-tag.own{background:#e6f6ee;color:#1f7a52}
.dx-seemore{width:100%;border:1px dashed #d8cbb6;border-radius:13px;background:#fffaf2;color:var(--ink);padding:11px;font:inherit;font-weight:900;min-height:44px;cursor:pointer}
#dxPick .dx-search,#dxName input,#dxManual input{width:100%;border:1px solid #ded6ca;border-radius:13px;padding:12px 14px;font:inherit;font-size:16px;background:#fff;color:var(--ink)}
#dxPick .dx-results{display:grid;gap:8px;margin-top:12px;max-height:52vh;overflow:auto}
.dx-res{display:grid;grid-template-columns:52px minmax(0,1fr);gap:10px;align-items:center;width:100%;border:1px solid var(--line);border-radius:14px;padding:7px;background:#fff;text-align:left;color:var(--ink);font:inherit;cursor:pointer}
.dx-res .dx-thumb{width:52px;height:52px}
.dx-res small{display:block;color:var(--muted);font-size:12px}
#dxManual{margin-top:14px;border-top:1px dashed var(--line);padding-top:12px;display:grid;gap:8px}
#dxManual[hidden]{display:none}
#dxManual h3,#dxName h3{margin:4px 0;font-size:14px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.dx-chips{display:flex;flex-wrap:wrap;gap:8px}
.dx-chip{display:inline-flex;align-items:center;gap:7px;border:1px solid #ded6ca;border-radius:999px;background:#fffaf2;padding:9px 15px;font:inherit;font-weight:850;min-height:44px;color:var(--ink);cursor:pointer}
.dx-chip i{width:11px;height:11px;border-radius:4px}
.dx-chip-wrap{display:inline-flex}
.dx-chip-wrap .dx-chip{border-radius:999px 0 0 999px;border-right:0}
.dx-forget{border:1px solid #ded6ca;border-radius:0 999px 999px 0;background:#fff1ee;color:#a2412f;min-height:44px;min-width:38px;font-size:18px;font-weight:900;cursor:pointer}
.dx-form{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;margin-top:14px}
.dx-err{color:#c0392b;font-weight:800;min-height:1.2em;margin:8px 0 0;font-size:14px}
.dx-bookline{background:#f8f5ef;border-radius:12px;padding:9px 12px;margin:0 0 10px}
#dxDialog .edition-box{width:min(460px,96vw)}
#dxDialog .dx-dlg-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:14px}
#dxDialog .dx-dlg-disc{display:grid;grid-template-columns:64px minmax(0,1fr);gap:12px;align-items:start}
#dxDialog .dx-dlg-disc .dx-thumb{width:64px;height:64px}
#dxDialog p{margin:0 0 6px}
@media(max-width:780px){.dx-btns{width:100%}.dx-btns .dx-btn{flex:1 1 45%}.dx-form{grid-template-columns:1fr}.dx-arrow{width:46px}#dxDialog .dx-dlg-actions .dx-btn{flex:1 1 45%}}`;
    document.head.appendChild(el);
  }

  /* ---------- Estructura (menú, páginas y ventanas) ---------- */
  function build() {
    const sw = $('#switchApplication');
    const main = $('main.wrap');
    if (!sw || !main || $('#discLoans')) return false;
    sw.insertAdjacentHTML('beforebegin', `<button class="navbtn" type="button" data-page="discLoans" data-dx-nav><span class="nicon">🤝</span><span><b>Discos de viaje</b><small>Préstamos y solicitudes de discos</small></span></button><button class="navbtn" type="button" data-page="discPending" data-dx-nav><span class="nicon">🎧</span><span><b>Álbumes pendientes</b><small>Lo que toca escuchar y lo que te recomiendan</small></span></button>`);
    main.insertAdjacentHTML('beforeend', `<section class="page" id="discLoans"><div class="hero"><div><h2>Discos de viaje</h2><p>Los discos de casa que están de viaje: de quién son, a quién se han prestado y desde cuándo. Y si quieres uno de otra persona, pídeselo aquí.</p></div><div class="dx-btns"><button type="button" class="dx-btn alt" id="dxAskBtn">🙋 Pedir un disco</button><button type="button" class="dx-btn" id="dxLendBtn">🤝 Prestar un disco</button></div></div>
      <div id="dxLoansNote"></div>
      <h3 class="dx-sub">🤝 Prestados ahora</h3><div class="dx-list" id="dxLoans"></div>
      <h3 class="dx-sub">🙋 Solicitudes de préstamo <small id="dxReqCount"></small></h3><div class="dx-list" id="dxRequests"></div></section>
      <section class="page" id="discPending"><div class="hero"><div><h2>Álbumes pendientes</h2><p>Lo que cada uno quiere escuchar y lo que le recomiendan los demás, todo en una sola lista.</p></div></div>
      <div class="person-tabs" id="dxPendPeople" role="group" aria-label="Persona de Álbumes pendientes"></div><div id="dxPendGrid"></div></section>`);
    document.body.insertAdjacentHTML('beforeend', `<div class="scan-modal" id="dxPick" role="dialog" aria-modal="true" aria-labelledby="dxPickTitle"><div class="edition-box"><button type="button" class="scan-close" data-dx-close>Cerrar</button><h2 id="dxPickTitle">Elegir un disco</h2><p id="dxPickHint"></p><input class="dx-search" id="dxPickQ" type="search" autocomplete="off" placeholder="🔎 Álbum o artista…" aria-label="Buscar un disco de casa"><div class="dx-results" id="dxPickResults"></div>
        <form id="dxManual" hidden novalidate><h3>¿No está en casa? Escríbelo</h3><input id="dxManAlbum" maxlength="300" placeholder="Nombre del álbum" aria-label="Nombre del álbum"><input id="dxManArtist" maxlength="300" placeholder="Artista" aria-label="Artista"><button type="submit" class="dx-btn">Apuntar este álbum</button><p class="dx-err" id="dxManErr" role="alert"></p></form></div></div>
      <div class="scan-modal" id="dxName" role="dialog" aria-modal="true" aria-labelledby="dxNameTitle"><div class="edition-box"><button type="button" class="scan-close" data-dx-close>Cerrar</button><h2 id="dxNameTitle">¿Quién?</h2><p id="dxNameHint"></p><div class="dx-bookline" id="dxNameDisc"></div><h3>De la familia</h3><div class="dx-chips" id="dxNameFam"></div><div id="dxNameSavedWrap" hidden><h3>Otras personas</h3><div class="dx-chips" id="dxNameSaved"></div></div><form class="dx-form" id="dxNameForm" novalidate><input id="dxNameInput" maxlength="60" autocomplete="off" enterkeyhint="done" placeholder="O escribe otro nombre…" aria-label="Otro nombre"><button type="submit" class="dx-btn">Usar este nombre</button></form><p class="dx-err" id="dxNameErr" role="alert"></p></div></div>
      <div class="scan-modal" id="dxDialog" role="dialog" aria-modal="true" aria-labelledby="dxDlgTitle"><div class="edition-box"><h2 id="dxDlgTitle"></h2><div id="dxDlgBody"></div><div class="dx-dlg-actions" id="dxDlgActions"></div></div></div>`);
    return true;
  }

  function showMyPage(id) {
    document.querySelectorAll('.navbtn').forEach((x) => x.classList.toggle('active', x.dataset.page === id));
    document.querySelectorAll('.page').forEach((x) => x.classList.toggle('active', x.id === id));
    $('#drawer')?.classList.remove('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    paint();
    refresh();
  }
  const activePage = () => $('#discLoans.active') ? 'discLoans' : $('#discPending.active') ? 'discPending' : null;

  /* ---------- Ventanas ---------- */
  const open = (el) => el.classList.add('open');
  const close = (el) => el.classList.remove('open');

  let dlgResolve = null;
  function dialog({ title, html, buttons }) {
    if (dlgResolve) dlgResolve(null);
    return new Promise((resolve) => {
      dlgResolve = resolve;
      $('#dxDlgTitle').textContent = title;
      $('#dxDlgBody').innerHTML = html || '';
      $('#dxDlgActions').innerHTML = buttons.map((b, i) => `<button type="button" class="dx-btn ${esc(b.kind || 'grey')}" data-dx-dlg="${i}">${esc(b.label)}</button>`).join('');
      $('#dxDialog').__buttons = buttons;
      open($('#dxDialog'));
      setTimeout(() => $('#dxDlgActions button')?.focus(), 40);
    });
  }
  function endDialog(value) { const r = dlgResolve; dlgResolve = null; close($('#dxDialog')); r?.(value); }
  const confirmBox = async (title, text, ok = 'Sí', kind = 'coral') => (await dialog({ title, html: `<p>${esc(text)}</p>`, buttons: [{ label: 'Cancelar', value: false }, { label: ok, value: true, kind }] })) === true;

  /* ---------- Nombres ---------- */
  let nameResolve = null;
  let nameOpts = {};
  function askName(opts) {
    if (nameResolve) nameResolve(null);
    nameOpts = opts;
    return new Promise((resolve) => {
      nameResolve = resolve;
      $('#dxNameTitle').textContent = opts.title;
      $('#dxNameHint').textContent = opts.hint || '';
      $('#dxNameDisc').hidden = !opts.disc;
      $('#dxNameDisc').innerHTML = opts.disc ? `💿 <b>${esc(opts.disc)}</b>` : '';
      $('#dxNameInput').value = '';
      $('#dxNameErr').textContent = '';
      paintNames();
      open($('#dxName'));
    });
  }
  function paintNames() {
    const ex = (nameOpts.exclude || []).map(nrm);
    $('#dxNameFam').innerHTML = FAM.filter((p) => !ex.includes(nrm(p))).map((p) => `<button type="button" class="dx-chip" data-dx-name="${esc(p)}"><i style="background:${esc(colorOf(p))}"></i>${esc(p)}</button>`).join('');
    const saved = st.people.filter((p) => !ex.includes(p.name_key)).sort((a, b) => collator.compare(a.name, b.name));
    $('#dxNameSavedWrap').hidden = !saved.length;
    $('#dxNameSaved').innerHTML = saved.map((p) => `<span class="dx-chip-wrap"><button type="button" class="dx-chip" data-dx-name="${esc(p.name)}"><i style="background:${esc(colorOf(p.name))}"></i>${esc(p.name)}</button><button type="button" class="dx-forget" data-dx-forget="${esc(p.id)}" aria-label="Olvidar el nombre ${esc(p.name)}" title="Olvidar este nombre">×</button></span>`).join('');
  }
  function endName(v) { const r = nameResolve; nameResolve = null; close($('#dxName')); r?.(v); }
  async function chooseName(raw) {
    const typed = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!typed) { $('#dxNameErr').textContent = 'Escribe un nombre o elige uno de la lista.'; return; }
    if ((nameOpts.exclude || []).map(nrm).includes(nrm(typed))) { $('#dxNameErr').textContent = nameOpts.excludeText || 'Ese nombre no vale aquí.'; return; }
    const fam = FAM.find((p) => nrm(p) === nrm(typed));
    const saved = st.people.find((p) => p.name_key === nrm(typed));
    const name = fam || saved?.name || typed;
    if (!fam && !saved) {
      try {
        const row = await rest(`${TB.people}?on_conflict=name_key`, { method: 'POST', body: { id: uuid(), name, name_key: nrm(name) }, prefer: 'resolution=ignore-duplicates,return=representation' });
        if (row?.[0]) st.people.push(row[0]);
      } catch (e) { console.warn('[Discoteca] No se pudo guardar el nombre para la próxima vez', e); }
    }
    endName(name);
  }
  async function forgetName(id) {
    const p = st.people.find((x) => x.id === id);
    if (!p) return;
    close($('#dxName'));
    const ok = await confirmBox('Olvidar este nombre', `¿Quitar «${p.name}» de los nombres guardados? Lo que ya está apuntado no cambia.`, 'Quitar');
    if (ok) { try { await remove(TB.people, p.id); st.people = st.people.filter((x) => x.id !== id); } catch (e) { toast(e.message, 4000); } }
    paintNames();
    open($('#dxName'));
  }

  /* ---------- Pintar ---------- */
  const thumb = (cover, label) => `<span class="dx-thumb">${cover ? `<img src="${esc(cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}${cover ? '' : '💿'}<span hidden>${esc(label || '')}</span></span>`;
  const who = (name, cls = '') => `<span class="dx-who ${cls}" style="--c:${esc(colorOf(name))}" title="${esc(name)}"><i></i><span>${esc(name)}</span></span>`;
  const discHead = (r) => `<button type="button" class="dx-disc" data-dx-open="${esc(r.disc_key)}">${thumb(r.cover, r.album)}<span class="dx-title"><b>${esc(r.album || 'Sin título')}</b><span>${esc(r.artist || 'Artista desconocido')}${r.category ? ` · ${esc(r.category)}` : ''}</span></span></button>`;
  const loanOf = (k) => st.loans.find((l) => l.disc_key === k) || null;

  function paint() {
    const page = activePage();
    if (page === 'discLoans') paintLoans();
    if (page === 'discPending') paintPending();
  }

  function paintLoans() {
    const note = $('#dxLoansNote');
    note.innerHTML = st.error ? `<div class="dx-note">${esc(st.error)} ${st.missing ? '' : '<button type="button" class="dx-btn grey" data-dx-retry>Reintentar</button>'}</div>` : '';
    if (st.missing) { $('#dxLoans').innerHTML = ''; $('#dxRequests').innerHTML = ''; return; }
    const wait = st.loading && !st.loans.length ? '<div class="dx-empty">Cargando…</div>' : '';
    $('#dxLoans').innerHTML = wait || (st.loans.length ? st.loans.map((l) => {
      const from = l.owners?.length ? l.owners.map((o) => who(o)).join('<span class="dx-and">y</span>') : who('Casa');
      return `<article class="dx-card">${discHead(l)}
        <div class="dx-route" aria-label="${esc(`De ${(l.owners || []).join(' y ') || 'casa'} a ${l.borrower}`)}"><div class="dx-side">${from}</div><span class="dx-arrow" aria-hidden="true"><i></i><span>💿</span></span><div class="dx-side">${who(l.borrower, 'to')}</div></div>
        <small class="dx-since">🗓️ Prestado el ${esc(fmtDate(l.lent_on || l.created_at))} · ${esc(daysAgo(l.lent_on || l.created_at))}</small>
        <button type="button" class="dx-btn mint dx-back" data-dx-back="${esc(l.id)}">✅ Devuelto</button></article>`;
    }).join('') : '<div class="dx-empty">Todos los discos están en casa. Pulsa «Prestar un disco» cuando se vaya alguno de viaje.</div>');
    $('#dxReqCount').textContent = st.requests.length ? plural(st.requests.length, 'solicitud', 'solicitudes') : '';
    $('#dxRequests').innerHTML = wait || (st.requests.length ? st.requests.map((r) => {
      const lent = loanOf(r.disc_key);
      return `<article class="dx-card req">${discHead(r)}
        <div class="dx-route" aria-label="${esc(`${r.requester} se lo pide a ${r.owner}`)}"><div class="dx-side">${who(r.requester, 'to')}</div><span class="dx-arrow ask" aria-hidden="true"><i></i><span>🙋</span></span><div class="dx-side">${who(r.owner)}</div></div>
        <small class="dx-since">🙋 ${esc(r.requester)} se lo pide a ${esc(r.owner)} · ${esc(fmtDate(r.created_at))}${lent ? ` · <b>ahora lo tiene ${esc(lent.borrower)}</b>` : ''}</small>
        <div class="dx-row2"><button type="button" class="dx-btn mint" data-dx-reqlend="${esc(r.id)}" ${lent ? 'disabled' : ''}>🤝 Prestárselo</button><button type="button" class="dx-btn soft" data-dx-reqrm="${esc(r.id)}">✖ Quitar</button></div></article>`;
    }).join('') : '<div class="dx-empty">Nadie ha pedido ningún disco. Pulsa «Pedir un disco» para pedírselo a alguien de casa.</div>');
  }

  function pendRow(p) {
    const own = p.added_by === p.person;
    return `<button type="button" class="dx-item" data-dx-pend="${esc(p.id)}">${thumb(p.cover, p.album)}<span><b>${esc(p.album || 'Sin título')}</b><span class="dx-artist"> · ${esc(p.artist || 'Artista desconocido')}</span>
      <small>${own ? '<span class="dx-tag own">🎧 Pendiente propio</span>' : `<span class="dx-tag rec">💌 Recomendación</span> de <span class="dx-by" style="--c:${esc(colorOf(p.added_by))}">${esc(p.added_by)}</span>`} · ${esc(fmtDate(p.created_at))}${p.in_home ? '' : ' · <em>no está en casa</em>'}</small></span><span class="dx-more-ico" aria-hidden="true">⋯</span></button>`;
  }
  function paintPending() {
    const person = st.pendPerson;
    $('#dxPendPeople').innerHTML = FAM.map((o) => `<button type="button" class="person-tab${o === person ? ' active' : ''}" data-dx-person="${esc(o)}" aria-pressed="${o === person}"><i style="background:${esc(colorOf(o))}"></i>${esc(o)}</button>`).join('');
    const grid = $('#dxPendGrid');
    if (st.error) { grid.innerHTML = `<div class="dx-note">${esc(st.error)} ${st.missing ? '' : '<button type="button" class="dx-btn grey" data-dx-retry>Reintentar</button>'}</div>`; if (st.missing) return; }
    const list = st.pending.filter((p) => p.person === person).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const shown = st.more ? list : list.slice(0, LIMIT);
    const body = st.loading && !st.pending.length ? '<div class="dx-empty">Cargando…</div>'
      : list.length ? shown.map(pendRow).join('') + (list.length > LIMIT ? `<button type="button" class="dx-seemore" data-dx-more aria-expanded="${st.more}">${st.more ? 'Ver menos ▲' : `Ver más (${list.length - LIMIT} más) ▼`}</button>` : '')
        : `<div class="wishlist-empty">${esc(person)} no tiene álbumes pendientes. Apunta uno o recomiéndaselo.</div>`;
    grid.innerHTML = (st.error ? grid.innerHTML : '') + `<section class="wishlist-card dx-pend" data-owner="${esc(person)}"><div class="wishlist-card-head"><div class="wishlist-person"><i class="wishlist-dot" style="background:${esc(colorOf(person))}"></i><h3>${esc(person)}</h3><span class="wishlist-count">${plural(list.length, 'álbum', 'álbumes')}</span></div><div class="wishlist-add-group"><button type="button" class="wishlist-add" data-dx-addhome="${esc(person)}">💿 De casa</button><button type="button" class="wishlist-add scan" data-dx-addother="${esc(person)}">✍️ Otro disco</button></div></div>
      <p class="dx-hint">Si lo apunta ${esc(person)}, es un pendiente suyo; si lo apunta otra persona, es una recomendación. Toca un álbum para marcarlo como escuchado o quitarlo.</p>
      <div class="dx-items">${body}</div></section>`;
  }

  /* ---------- Elegir un disco ---------- */
  function openPick(mode, { person = null, owner = null } = {}) {
    st.pick = { mode, person, owner };
    $('#dxPickTitle').textContent = mode === 'loan' ? '¿Qué disco se va de viaje?' : mode === 'request' ? `¿Qué disco le pides a ${owner}?` : `Álbum pendiente para ${person}`;
    $('#dxPickHint').textContent = mode === 'loan' ? 'Elige el disco de casa que vas a prestar.' : mode === 'request' ? `Solo salen los discos de ${owner}.` : 'Busca un disco de la colección de casa.';
    $('#dxPickQ').value = '';
    $('#dxManual').hidden = mode !== 'pend';
    $('#dxManAlbum').value = '';
    $('#dxManArtist').value = '';
    $('#dxManErr').textContent = '';
    paintPick();
    open($('#dxPick'));
    setTimeout(() => $('#dxPickQ').focus(), 80);
  }
  function paintPick() {
    const { mode, person, owner } = st.pick;
    const q = nrm($('#dxPickQ').value);
    let pool = discs();
    if (mode === 'request') pool = pool.filter((d) => ownersOf(d).includes(owner));
    if (q) pool = pool.filter((d) => nrm(`${d.album} ${d.artist}`).includes(q) || q.split(' ').every((w) => nrm(`${d.album} ${d.artist}`).includes(w)));
    const total = pool.length;
    pool = pool.slice().sort((a, b) => collator.compare(String(a.album), String(b.album))).slice(0, 60);
    $('#dxPickResults').innerHTML = pool.length ? pool.map((d) => {
      const k = discKey(d);
      const lent = loanOf(k);
      let tag = '';
      if ((mode === 'loan' || mode === 'request') && lent) tag = `Prestado a ${lent.borrower}`;
      if (mode === 'request' && st.requests.some((r) => r.disc_key === k && r.requester === person)) tag = 'Ya lo ha pedido';
      if (mode === 'pend' && st.pending.some((p) => p.disc_key === k && p.person === person)) tag = 'Ya está en su lista';
      return `<button type="button" class="dx-res" data-dx-pick="${esc(k)}">${thumb(d.cover, d.album)}<span><b>${esc(d.album || 'Sin título')}</b><small>${esc(d.artist || '')} · ${esc(d.category || '')} · ${esc(ownersOf(d).join(' y '))}</small>${tag ? `<span class="dx-tag">${esc(tag)}</span>` : ''}</span></button>`;
    }).join('') + (total > pool.length ? `<p class="dx-hint">Se muestran 60 de ${total}. Escribe más letras para afinar.</p>` : '')
      : `<div class="dx-empty">${mode === 'request' ? `No hay ningún disco de ${esc(owner)}${q ? ' con ese nombre' : ''}.` : 'No hay ningún disco de casa con ese nombre.'}</div>`;
  }

  async function onPick(k) {
    const d = discByKey(k);
    if (!d) return;
    const { mode, person, owner } = st.pick;
    if (mode === 'loan') return lend(d);
    if (mode === 'request') return request(d, person, owner);
    return addPending(snapshot(d), person, true);
  }

  /* ---------- Préstamos ---------- */
  async function lend(d, given = null) {
    const snap = snapshot(d);
    const prev = loanOf(snap.disc_key);
    if (prev) { toast(`«${snap.album}» ya está prestado a ${prev.borrower}`); return false; }
    close($('#dxPick'));
    const borrower = given || await askName({ title: '¿A quién se lo prestas?', hint: snap.owners.length ? `Es de ${snap.owners.join(' y ')}. Elige a alguien de la familia o escribe otro nombre.` : 'Elige a alguien de la familia o escribe otro nombre.', disc: `${snap.album} · ${snap.artist}`, exclude: snap.owners, excludeText: 'El disco ya es suyo: elige a otra persona.' });
    if (!borrower) return false;
    try {
      await insert(TB.loans, { id: uuid(), ...snap, borrower, lent_on: today() });
      toast(`🤝 «${snap.album}» se va de viaje con ${borrower}`);
      await refresh(['loans']);
      return true;
    } catch (e) { toast(e.duplicate ? 'Ese disco ya estaba prestado.' : e.message, 4000); await refresh(['loans']); return false; }
  }
  async function returned(id) {
    const l = st.loans.find((x) => x.id === id);
    if (!l) return;
    if (!(await confirmBox('¿Ha vuelto a casa?', `¿${l.borrower} ya ha devuelto «${l.album}»${l.owners?.length ? ` a ${l.owners.join(' y ')}` : ''}?`, '✅ Sí, devuelto', 'mint'))) return;
    try { await remove(TB.loans, id); toast('💿 ¡De vuelta en casa!'); } catch (e) { toast(e.message, 4000); }
    await refresh(['loans']);
  }

  /* ---------- Solicitudes ---------- */
  async function newRequest() {
    if (st.missing) { toast(`Falta ejecutar ${SQL_FILE} en Supabase.`, 4000); return; }
    const requester = await askName({ title: '¿Quién pide el disco?', hint: 'Elige a alguien de la familia o escribe otro nombre.' });
    if (!requester) return;
    const options = FAM.filter((p) => p !== requester && discs().some((d) => ownersOf(d).includes(p)));
    if (!options.length) { toast('No hay discos de otras personas para pedir.'); return; }
    const owner = await dialog({ title: '¿A quién se lo pides?', html: `<p>${esc(requester)} quiere un disco de…</p>`, buttons: [...options.map((p) => ({ label: p, value: p, kind: 'coral' })), { label: 'Cancelar', value: null }] });
    if (!owner) return;
    openPick('request', { person: requester, owner });
  }
  async function request(d, requester, owner) {
    const snap = snapshot(d);
    if (st.requests.some((r) => r.disc_key === snap.disc_key && r.requester === requester)) { toast(`${requester} ya había pedido «${snap.album}»`); return; }
    try {
      await insert(TB.requests, { id: uuid(), ...snap, requester, owner });
      close($('#dxPick'));
      const lent = loanOf(snap.disc_key);
      toast(lent ? `🙋 Pedido. Ojo: ahora lo tiene ${lent.borrower}.` : `🙋 ${requester} le pide «${snap.album}» a ${owner}`);
    } catch (e) { toast(e.duplicate ? 'Esa solicitud ya estaba apuntada.' : e.message, 4000); }
    await refresh(['requests']);
  }
  async function removeRequest(id, ask = true) {
    const r = st.requests.find((x) => x.id === id);
    if (!r) return false;
    if (ask && !(await confirmBox('Quitar la solicitud', `¿Quitar la solicitud de ${r.requester} para «${r.album}»?`, 'Quitar'))) return false;
    try { await remove(TB.requests, id); if (ask) toast('Solicitud quitada'); } catch (e) { toast(e.message, 4000); await refresh(['requests']); return false; }
    await refresh(['requests']);
    return true;
  }
  async function lendRequest(id) {
    const r = st.requests.find((x) => x.id === id);
    if (!r) return;
    const d = discByKey(r.disc_key);
    if (!d) { toast('Ese disco ya no está en la colección (quizá se editó o se borró).', 4000); return; }
    if (!(await confirmBox('Prestar el disco', `¿${r.owner} le presta «${r.album}» a ${r.requester}?`, '🤝 Sí, prestar', 'mint'))) return;
    if (await lend(d, r.requester)) await removeRequest(r.id, false);
  }

  /* ---------- Álbumes pendientes ---------- */
  async function addPending(snap, person, inHome) {
    if (st.pending.some((p) => p.disc_key === snap.disc_key && p.person === person)) { toast(`Ese álbum ya está en la lista de ${person}`); return; }
    close($('#dxPick'));
    const by = await askName({ title: '¿Quién lo apunta?', hint: `Si lo apunta ${person}, queda como pendiente suyo; si es otra persona, como recomendación para ${person}.`, disc: `${snap.album} · ${snap.artist}` });
    if (!by) return;
    try {
      await insert(TB.pending, { id: uuid(), person, ...snap, in_home: inHome, added_by: by });
      toast(by === person ? `🎧 Apuntado en los pendientes de ${person}` : `💌 ${by} le recomienda «${snap.album}» a ${person}`);
    } catch (e) { toast(e.duplicate ? `Ese álbum ya estaba en la lista de ${person}.` : e.message, 4000); }
    await refresh(['pending']);
  }
  async function addManual() {
    const album = $('#dxManAlbum').value.replace(/\s+/g, ' ').trim();
    const artist = $('#dxManArtist').value.replace(/\s+/g, ' ').trim();
    if (!album) { $('#dxManErr').textContent = 'Escribe al menos el nombre del álbum.'; $('#dxManAlbum').focus(); return; }
    const snap = { disc_key: `fuera|${nrm(album)}|${nrm(artist)}`.slice(0, 600), album: album.slice(0, 300), artist: artist.slice(0, 300), category: null, cover: null, owners: [] };
    const home = discs().find((d) => nrm(d.album) === nrm(album) && (!artist || nrm(d.artist) === nrm(artist)));
    await addPending(home ? snapshot(home) : snap, st.pick.person, !!home);
  }
  async function openPendingItem(id) {
    const p = st.pending.find((x) => x.id === id);
    if (!p) return;
    const d = p.in_home ? discByKey(p.disc_key) : null;
    const own = p.added_by === p.person;
    const choice = await dialog({
      title: p.album || 'Sin título',
      html: `<div class="dx-dlg-disc">${thumb(p.cover, p.album)}<div><p><b>${esc(p.artist || 'Artista desconocido')}</b>${p.category ? ` · ${esc(p.category)}` : ''}</p><p>${own ? `🎧 ${esc(p.person)} lo tiene pendiente` : `💌 ${esc(p.added_by)} se lo recomienda a <b>${esc(p.person)}</b>`} desde el ${esc(fmtDate(p.created_at))}.</p><p class="dx-hint">${p.in_home ? `Está en casa${p.owners?.length ? `: es de ${esc(p.owners.join(' y '))}` : ''}.` : 'No está en la colección de casa.'}</p></div></div>`,
      buttons: [
        { label: '🎧 Ya lo he escuchado', value: 'done', kind: 'mint' },
        ...(d && openAlbumSafe() ? [{ label: '💿 Ver el disco', value: 'see', kind: 'coral' }] : []),
        { label: '🗑 Quitar de la lista', value: 'rm', kind: 'soft' },
        { label: 'Cancelar', value: null }
      ]
    });
    if (choice === 'see') { const fn = openAlbumSafe(); if (fn && d) fn(d, true); return; }
    if (choice === 'rm' && !(await confirmBox('Quitar de la lista', `¿Quitar «${p.album}» de los álbumes pendientes de ${p.person}?`, 'Quitar'))) return;
    if (choice === 'done' || choice === 'rm') {
      try { await remove(TB.pending, id); toast(choice === 'done' ? '🎶 ¡Escuchado! A por el siguiente.' : 'Quitado de la lista'); } catch (e) { toast(e.message, 4000); }
      await refresh(['pending']);
    }
  }
  // eslint-disable-next-line no-undef
  function openAlbumSafe() { try { return typeof openAlbum === 'function' ? openAlbum : null; } catch { return null; } }

  /* ---------- Eventos ---------- */
  function bind() {
    document.querySelectorAll('[data-dx-nav]').forEach((b) => b.addEventListener('click', () => showMyPage(b.dataset.page)));
    $('#dxLendBtn').addEventListener('click', () => (st.missing ? toast(`Falta ejecutar ${SQL_FILE} en Supabase.`, 4000) : openPick('loan')));
    $('#dxAskBtn').addEventListener('click', newRequest);
    $('#discLoans').addEventListener('click', (e) => {
      const t = e.target;
      if (t.closest('[data-dx-retry]')) return refresh();
      const back = t.closest('[data-dx-back]');
      if (back) return returned(back.dataset.dxBack);
      const lendR = t.closest('[data-dx-reqlend]');
      if (lendR) return lendRequest(lendR.dataset.dxReqlend);
      const rm = t.closest('[data-dx-reqrm]');
      if (rm) return removeRequest(rm.dataset.dxReqrm);
      const op = t.closest('[data-dx-open]');
      if (op) { const d = discByKey(op.dataset.dxOpen); const fn = openAlbumSafe(); if (d && fn) fn(d, true); else toast('Ese disco ya no está tal cual en la colección.'); }
    });
    $('#discPending').addEventListener('click', (e) => {
      const t = e.target;
      if (t.closest('[data-dx-retry]')) return refresh();
      const pp = t.closest('[data-dx-person]');
      if (pp) { st.pendPerson = pp.dataset.dxPerson; st.more = false; paintPending(); return; }
      if (t.closest('[data-dx-more]')) { st.more = !st.more; paintPending(); return; }
      if (st.missing && t.closest('[data-dx-addhome],[data-dx-addother]')) { toast(`Falta ejecutar ${SQL_FILE} en Supabase.`, 4000); return; }
      const h = t.closest('[data-dx-addhome]');
      if (h) return openPick('pend', { person: h.dataset.dxAddhome });
      const o = t.closest('[data-dx-addother]');
      if (o) { openPick('pend', { person: o.dataset.dxAddother }); setTimeout(() => $('#dxManAlbum').focus(), 120); return; }
      const it = t.closest('[data-dx-pend]');
      if (it) openPendingItem(it.dataset.dxPend);
    });
    $('#dxPickQ').addEventListener('input', paintPick);
    $('#dxPick').addEventListener('click', (e) => {
      if (e.target.id === 'dxPick' || e.target.closest('[data-dx-close]')) return close($('#dxPick'));
      const p = e.target.closest('[data-dx-pick]');
      if (p) onPick(p.dataset.dxPick);
    });
    $('#dxManual').addEventListener('submit', (e) => { e.preventDefault(); addManual(); });
    $('#dxName').addEventListener('click', (e) => {
      if (e.target.id === 'dxName' || e.target.closest('[data-dx-close]')) return endName(null);
      const f = e.target.closest('[data-dx-forget]');
      if (f) return forgetName(f.dataset.dxForget);
      const n = e.target.closest('[data-dx-name]');
      if (n) chooseName(n.dataset.dxName);
    });
    $('#dxNameForm').addEventListener('submit', (e) => { e.preventDefault(); chooseName($('#dxNameInput').value); });
    $('#dxDialog').addEventListener('click', (e) => {
      if (e.target.id === 'dxDialog') return endDialog(null);
      const b = e.target.closest('[data-dx-dlg]');
      if (b) endDialog($('#dxDialog').__buttons[Number(b.dataset.dxDlg)]?.value ?? null);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if ($('#dxDialog.open')) { e.preventDefault(); endDialog(null); } else if ($('#dxName.open')) { e.preventDefault(); endName(null); } else if ($('#dxPick.open')) { e.preventDefault(); close($('#dxPick')); }
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && activePage()) refresh(); });
    window.addEventListener('online', () => { if (activePage()) refresh(); });
  }

  function init() {
    if (!build()) return;
    injectStyles();
    bind();
  }
  window.HogarDiscosExtra = { refresh, discKey };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
