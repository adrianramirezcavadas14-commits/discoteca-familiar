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
      const missing = data?.code !== 'PGRST204' && (res.status === 404 || ['PGRST205', 'PGRST202', '42P01'].includes(data?.code) || /does not exist|Could not find/i.test(msg));
      if (missing) throw new RestError(`Falta preparar esta sección en Supabase: ejecuta ${SQL_FILE}.`, { missing: true });
      if (data?.code === '23505') throw new RestError('Ya estaba apuntado.', { duplicate: true });
      if (data?.code === 'PGRST204') throw new RestError(msg, { column: true });
      throw new RestError(msg || `Error ${res.status} al hablar con Supabase.`);
    }
    return data;
  }
  const selectAll = (t, order = 'created_at.asc') => rest(`${t}?select=*&order=${order}`);
  const insert = async (t, row) => (await rest(t, { method: 'POST', body: row, prefer: 'return=representation' }))?.[0] || row;
  /** Datos extra de la edición (año, país, sello, fuente). Si la tabla aún no tiene esas columnas, se guarda sin ellas. */
  const EXTRA = ['year', 'country', 'label', 'source', 'source_url', 'cover_alt'];
  async function insertWithExtras(t, row) {
    try { return await insert(t, row); } catch (e) {
      if (!e.column) throw e;
      const basic = { ...row };
      EXTRA.forEach((k) => delete basic[k]);
      return insert(t, basic);
    }
  }
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
.dx-btn.spotify{background:#1db954;color:#fff}
#modal .detail-recommend{background:#fde8f1;box-shadow:inset 0 0 0 1px #f3b9d2;font-size:18px;color:inherit}
#dxDialog .dx-dlg-actions .dx-btn.spotify{flex:1 1 100%;font-size:17px}
.dx-btn:disabled{opacity:.5;cursor:default}
.dx-sub{margin:26px 0 12px;font-size:20px;display:flex;align-items:center;gap:8px}
.dx-sub small{color:var(--muted);font-size:13px;font-weight:800}
.dx-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,360px),1fr));gap:16px}
.dx-card{background:#fff;border:1px solid var(--line);border-radius:22px;padding:16px;box-shadow:var(--shadow);display:grid;gap:12px;min-width:0}
.dx-card.req{border-style:dashed}
.dx-disc{display:grid;grid-template-columns:56px minmax(0,1fr);gap:11px;align-items:center;border:0;background:transparent;padding:0;text-align:left;color:inherit;font:inherit;min-width:0;cursor:pointer}
.dx-thumb{width:56px;height:56px;border-radius:12px;overflow:hidden;background:#f2ece2;display:grid;place-items:center;font-size:26px;flex:0 0 auto}
.dx-thumb{position:relative}
.dx-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;background:#f2ece2}
.dx-thumb.big{width:100%;height:auto;aspect-ratio:1;font-size:46px;border-radius:14px}
.dx-meta{display:block;color:var(--muted);font-size:12px;font-weight:700;margin-top:1px}
.dx-goweb{margin-top:14px;border-top:1px dashed var(--line);padding-top:12px}
.dx-goweb .dx-btn{width:100%}
.dx-web-box{width:min(940px,96vw)}
.dx-web-form{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) auto;gap:8px}
.dx-web-form input{width:100%;min-width:0;border:1px solid #ded6ca;border-radius:13px;padding:12px 14px;font:inherit;font-size:16px;background:#fff;color:var(--ink)}
.dx-web-status{min-height:1.2em;margin:10px 0;color:var(--muted);font-weight:800;font-size:13px}
.dx-web-status.err{color:#c0392b}
.dx-editions{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;max-height:58vh;overflow:auto;padding:2px}
.dx-ed{display:grid;gap:8px;align-content:start;border:1px solid var(--line);border-radius:18px;padding:9px;background:#fff;text-align:left;color:var(--ink);font:inherit;cursor:pointer;transition:transform .15s,box-shadow .15s}
.dx-ed:hover,.dx-ed:focus-visible{transform:translateY(-2px);box-shadow:0 10px 22px #4b3b2620}
.dx-ed-txt{display:grid;gap:2px;min-width:0}
.dx-ed-txt b{font-size:14px;line-height:1.2;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.dx-ed-txt span{color:var(--muted);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dx-ed-txt small{color:#8a7a62;font-size:11px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dx-src{justify-self:start;margin-top:3px;border-radius:999px;padding:2px 8px;font-size:10px;font-weight:900;font-style:normal;color:#fff;background:#ba478f}
.dx-src.dg{background:#333}
.dx-searching{grid-column:1/-1}
.dx-editions .dx-empty{grid-column:1/-1}
.dx-web-foot{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-top:12px}
.dx-link{border:0;background:transparent;color:#4b3f8f;font:inherit;font-weight:900;text-decoration:underline;cursor:pointer;padding:8px 0}
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
.dx-item{grid-template-columns:72px minmax(0,1fr) auto}
.dx-item .dx-thumb{width:72px;height:72px}
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
#dxDialog .dx-dlg-disc{display:grid;grid-template-columns:140px minmax(0,1fr);gap:14px;align-items:start}
#dxDialog .dx-dlg-disc .dx-thumb{width:140px;height:140px}
#dxDialog p{margin:0 0 6px}
@media(max-width:780px){.dx-web-form{grid-template-columns:1fr}.dx-editions{grid-template-columns:repeat(2,minmax(0,1fr));max-height:none}#dxDialog .dx-dlg-disc{grid-template-columns:96px minmax(0,1fr)}#dxDialog .dx-dlg-disc .dx-thumb{width:96px;height:96px}.dx-btns{width:100%}.dx-btns .dx-btn{flex:1 1 45%}.dx-form{grid-template-columns:1fr}.dx-arrow{width:46px}#dxDialog .dx-dlg-actions .dx-btn{flex:1 1 45%}}`;
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
        <div id="dxGoWeb" class="dx-goweb" hidden><button type="button" class="dx-btn coral" data-dx-goweb>🌍 ¿No está en casa? Búscalo en internet</button></div></div></div>
      <div class="scan-modal" id="dxWeb" role="dialog" aria-modal="true" aria-labelledby="dxWebTitle"><div class="edition-box dx-web-box"><button type="button" class="scan-close" data-dx-close>Cerrar</button><h2 id="dxWebTitle">Buscar un álbum en internet</h2><p id="dxWebHint">Buscamos en MusicBrainz y Discogs. Elige la edición que quieres recomendar.</p>
        <form class="dx-web-form" id="dxWebForm" novalidate><input id="dxWebAlbum" maxlength="300" placeholder="Álbum" aria-label="Álbum" autocomplete="off"><input id="dxWebArtist" maxlength="300" placeholder="Artista (opcional)" aria-label="Artista" autocomplete="off"><button type="submit" class="dx-btn coral">🔎 Buscar</button></form>
        <p class="dx-web-status" id="dxWebStatus" role="status" aria-live="polite"></p>
        <div class="dx-editions" id="dxWebResults"></div>
        <div class="dx-web-foot"><button type="button" class="dx-btn grey" id="dxWebMore" hidden>Cargar más ediciones</button><button type="button" class="dx-link" id="dxWebManual" hidden>¿No aparece? Apuntarlo solo con el nombre</button></div></div></div>
      <div class="scan-modal" id="dxName" role="dialog" aria-modal="true" aria-labelledby="dxNameTitle"><div class="edition-box"><button type="button" class="scan-close" data-dx-close>Cerrar</button><h2 id="dxNameTitle">¿Quién?</h2><p id="dxNameHint"></p><div class="dx-bookline" id="dxNameDisc"></div><h3>De la familia</h3><div class="dx-chips" id="dxNameFam"></div><div id="dxNameSavedWrap" hidden><h3>Otras personas</h3><div class="dx-chips" id="dxNameSaved"></div></div><form class="dx-form" id="dxNameForm" novalidate><input id="dxNameInput" maxlength="60" autocomplete="off" enterkeyhint="done" placeholder="O escribe otro nombre…" aria-label="Otro nombre"><button type="submit" class="dx-btn">Usar este nombre</button></form><p class="dx-err" id="dxNameErr" role="alert"></p></div></div>
      <div class="scan-modal" id="dxDialog" role="dialog" aria-modal="true" aria-labelledby="dxDlgTitle"><div class="edition-box"><h2 id="dxDlgTitle"></h2><div id="dxDlgBody"></div><div class="dx-dlg-actions" id="dxDlgActions"></div></div></div>`);
    return true;
  }

  /* ---------- Recomendar desde la ficha del disco ---------- */
  function addRecommendButton() {
    const box = $('#modal .detail-actions');
    if (!box || box.querySelector('.detail-recommend')) return;
    box.insertAdjacentHTML('afterbegin', '<button class="ico detail-recommend" type="button" aria-label="Recomendar a alguien" title="Recomendar a alguien">💌</button>');
    box.querySelector('.detail-recommend').addEventListener('click', recommendFromDetail);
  }
  async function recommendFromDetail() {
    let d = null;
    // eslint-disable-next-line no-undef
    try { d = discs()[currentAlbumIndex] || null; } catch { d = null; }
    if (!d) return;
    $('#modal')?.classList.remove('open');
    if (!st.people.length && !st.missing) refresh(['people', 'pending']);
    const person = await dialog({ title: '💌 ¿A quién se lo recomiendas?', html: `<p>«${esc(d.album || 'Sin título')}» · ${esc(d.artist || '')}</p>`, buttons: [...FAM.map((p) => ({ label: p, value: p, kind: 'coral' })), { label: 'Cancelar', value: null }] });
    if (!person) return;
    st.pendPerson = person;
    st.more = false;
    const before = st.pending.length;
    await addPending(snapshot(d), person, true, '¿Quién lo recomienda?');
    if (st.pending.length > before || st.pending.some((p) => p.disc_key === discKey(d) && p.person === person)) showMyPage('discPending');
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
  const IMG_ERR = "if(this.dataset.alt){this.src=this.dataset.alt;this.dataset.alt=''}else{this.remove()}";
  const thumb = (cover, label, alt = '', cls = '') => `<span class="dx-thumb ${cls}" aria-hidden="true">💿${cover ? `<img src="${esc(cover)}" ${alt ? `data-alt="${esc(alt)}"` : ''} alt="" loading="lazy" referrerpolicy="no-referrer" onerror="${IMG_ERR}">` : ''}<span hidden>${esc(label || '')}</span></span>`;
  /** Portada: la de la colección de casa (aunque sea una imagen guardada) o la copiada al apuntarlo. */
  const coverFor = (r) => discByKey(r.disc_key)?.cover || r.cover || '';
  const who = (name, cls = '') => `<span class="dx-who ${cls}" style="--c:${esc(colorOf(name))}" title="${esc(name)}"><i></i><span>${esc(name)}</span></span>`;
  const discHead = (r) => `<button type="button" class="dx-disc" data-dx-open="${esc(r.disc_key)}">${thumb(coverFor(r), r.album)}<span class="dx-title"><b>${esc(r.album || 'Sin título')}</b><span>${esc(r.artist || 'Artista desconocido')}${r.category ? ` · ${esc(r.category)}` : ''}</span></span></button>`;
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
    const meta = [p.year, p.category, p.country].filter(Boolean).join(' · ');
    return `<button type="button" class="dx-item" data-dx-pend="${esc(p.id)}">${thumb(coverFor(p), p.album, p.cover_alt)}<span><b>${esc(p.album || 'Sin título')}</b><span class="dx-artist"> · ${esc(p.artist || 'Artista desconocido')}</span>${meta ? `<span class="dx-meta">${esc(meta)}</span>` : ''}
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
    grid.innerHTML = (st.error ? grid.innerHTML : '') + `<section class="wishlist-card dx-pend" data-owner="${esc(person)}"><div class="wishlist-card-head"><div class="wishlist-person"><i class="wishlist-dot" style="background:${esc(colorOf(person))}"></i><h3>${esc(person)}</h3><span class="wishlist-count">${plural(list.length, 'álbum', 'álbumes')}</span></div><div class="wishlist-add-group"><button type="button" class="wishlist-add" data-dx-addhome="${esc(person)}">💿 De casa</button><button type="button" class="wishlist-add scan" data-dx-addother="${esc(person)}">🌍 Buscar en internet</button></div></div>
      <p class="dx-hint">Si lo apunta ${esc(person)}, es un pendiente suyo; si lo apunta otra persona, es una recomendación. Si no está en casa, búscalo en internet y elige la edición. Toca un álbum para marcarlo como escuchado o quitarlo.</p>
      <div class="dx-items">${body}</div></section>`;
  }

  /* ---------- Elegir un disco ---------- */
  function openPick(mode, { person = null, owner = null } = {}) {
    st.pick = { mode, person, owner };
    $('#dxPickTitle').textContent = mode === 'loan' ? '¿Qué disco se va de viaje?' : mode === 'request' ? `¿Qué disco le pides a ${owner}?` : `Álbum pendiente para ${person}`;
    $('#dxPickHint').textContent = mode === 'loan' ? 'Elige el disco de casa que vas a prestar.' : mode === 'request' ? `Solo salen los discos de ${owner}.` : 'Busca un disco de la colección de casa.';
    $('#dxPickQ').value = '';
    $('#dxGoWeb').hidden = mode !== 'pend';
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
  async function addPending(snap, person, inHome, askTitle = '¿Quién lo apunta?') {
    if (st.pending.some((p) => p.disc_key === snap.disc_key && p.person === person)) { toast(`Ese álbum ya está en la lista de ${person}`); return; }
    close($('#dxPick'));
    const by = await askName({ title: askTitle, hint: `Si lo apunta ${person}, queda como pendiente suyo; si es otra persona, como recomendación para ${person}.`, disc: `${snap.album} · ${snap.artist}` });
    if (!by) return;
    try {
      await insertWithExtras(TB.pending, { id: uuid(), person, ...snap, in_home: inHome, added_by: by });
      toast(by === person ? `🎧 Apuntado en los pendientes de ${person}` : `💌 ${by} le recomienda «${snap.album}» a ${person}`);
    } catch (e) { toast(e.duplicate ? `Ese álbum ya estaba en la lista de ${person}.` : e.message, 4000); }
    await refresh(['pending']);
  }
  /** Solo con el nombre (si no aparece en MusicBrainz ni en Discogs). */
  async function addManual() {
    const album = $('#dxWebAlbum').value.replace(/\s+/g, ' ').trim();
    const artist = $('#dxWebArtist').value.replace(/\s+/g, ' ').trim();
    if (!album) { setWebStatus('Escribe al menos el nombre del álbum.', true); $('#dxWebAlbum').focus(); return; }
    const snap = { disc_key: `fuera|${nrm(album)}|${nrm(artist)}`.slice(0, 600), album: album.slice(0, 300), artist: artist.slice(0, 300), category: null, cover: null, owners: [] };
    const home = discs().find((d) => nrm(d.album) === nrm(album) && (!artist || nrm(d.artist) === nrm(artist)));
    close($('#dxWeb'));
    await addPending(home ? snapshot(home) : snap, web.person, !!home);
  }

  /* ---------- Buscar en internet (MusicBrainz y Discogs) ---------- */
  const web = { person: null, album: '', artist: '', page: 0, results: [], more: { mb: false, dg: false }, busy: false };
  const formatToCategory = (f) => { const t = nrm(f); return /vinyl|vinilo|lp\b|12"|7"/.test(t) ? 'Vinilo' : /cassette|casete|cinta/.test(t) ? 'Cassette' : /\bcd\b|cdr|sacd/.test(t) ? 'CD' : (f ? String(f).slice(0, 40) : null); };
  const timed = (url, opts = {}, ms = 12000) => { const c = new AbortController(); const tm = setTimeout(() => c.abort(), ms); return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(tm)); };
  const discogsToken = () => { try { return (localStorage.getItem('discogsToken') || '').trim(); } catch { return ''; } };

  async function searchMusicBrainz(album, artist, page) {
    const qq = (v) => `"${String(v).replace(/["\\]/g, ' ').trim()}"`;
    const q = [album && `release:${qq(album)}`, artist && `artist:${qq(artist)}`].filter(Boolean).join(' AND ');
    const res = await timed(`https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(q)}&fmt=json&limit=12&offset=${page * 12}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(res.status === 503 ? 'MusicBrainz está ocupado, prueba en unos segundos' : `MusicBrainz ${res.status}`);
    const js = await res.json().catch(() => { throw new Error('MusicBrainz ha devuelto una respuesta no válida'); });
    const out = (js.releases || []).map((r) => {
      const formats = [...new Set((r.media || []).map((m) => m.format).filter(Boolean))];
      return {
        source: 'MusicBrainz', id: `mb:${r.id}`,
        album: r.title || '', artist: (r['artist-credit'] || []).map((a) => (a.name || a.artist?.name || '') + (a.joinphrase || '')).join('').trim(),
        year: String(r.date || '').slice(0, 4), country: r.country || '', label: r['label-info']?.[0]?.label?.name || '',
        format: formats.join(' + '), category: formatToCategory(formats[0] || ''),
        cover: `https://coverartarchive.org/release/${r.id}/front-250`,
        cover_alt: r['release-group']?.id ? `https://coverartarchive.org/release-group/${r['release-group'].id}/front-250` : '',
        url: `https://musicbrainz.org/release/${r.id}`
      };
    });
    out.more = (js.count || 0) > (page + 1) * 12;
    return out;
  }
  async function searchDiscogs(album, artist, page) {
    const token = discogsToken();
    if (!token) return Object.assign([], { more: false, skipped: true });
    const u = new URL('https://api.discogs.com/database/search');
    if (album) u.searchParams.set('release_title', album);
    if (artist) u.searchParams.set('artist', artist);
    u.searchParams.set('type', 'release');
    u.searchParams.set('per_page', '12');
    u.searchParams.set('page', String(page + 1));
    u.searchParams.set('token', token);
    const res = await timed(u.toString(), { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'Discogs ha rechazado el token' : res.status === 429 ? 'Discogs pide esperar un momento' : `Discogs ${res.status}`);
    const js = await res.json().catch(() => { throw new Error('Discogs ha devuelto una respuesta no válida'); });
    const out = (js.results || []).map((x) => {
      const [a, ...t] = String(x.title || '').split(' - ');
      const formats = x.format || [];
      return {
        source: 'Discogs', id: `dg:${x.id}`,
        album: (t.join(' - ') || a || '').trim(), artist: t.length ? a.replace(/ \(\d+\)$/, '').trim() : '',
        year: String(x.year || ''), country: x.country || '', label: (x.label || [])[0] || '',
        format: formats.slice(0, 3).join(', '), category: formatToCategory(formats.join(' ')),
        cover: x.cover_image && !/spacer\.gif/.test(x.cover_image) ? x.cover_image : (x.thumb || ''), cover_alt: x.thumb || '',
        url: x.uri ? `https://www.discogs.com${x.uri}` : `https://www.discogs.com/release/${x.id}`
      };
    });
    out.more = (js.pagination?.pages || 1) > page + 1;
    return out;
  }

  function openWeb(person, album = '', artist = '') {
    web.person = person;
    $('#dxWebTitle').textContent = `Buscar un álbum para ${person}`;
    $('#dxWebHint').textContent = `Buscamos en MusicBrainz${discogsToken() ? ' y Discogs' : ''}. Elige la edición (portada, año, formato) que quieres apuntar.`;
    $('#dxWebAlbum').value = album;
    $('#dxWebArtist').value = artist;
    $('#dxWebResults').innerHTML = '';
    $('#dxWebMore').hidden = true;
    $('#dxWebManual').hidden = true;
    setWebStatus(discogsToken() ? '' : 'Para buscar también en Discogs, guarda tu token de Discogs en «Añadir disco» (se usa el mismo).');
    close($('#dxPick'));
    open($('#dxWeb'));
    setTimeout(() => $('#dxWebAlbum').focus(), 80);
    if (album.trim().length >= 2) runWeb(true);
  }
  function setWebStatus(text, err = false) { const el = $('#dxWebStatus'); el.textContent = text; el.classList.toggle('err', !!err); }

  async function runWeb(reset) {
    if (web.busy) return;
    if (reset) {
      web.album = $('#dxWebAlbum').value.replace(/\s+/g, ' ').trim();
      web.artist = $('#dxWebArtist').value.replace(/\s+/g, ' ').trim();
      if (!web.album && !web.artist) { setWebStatus('Escribe el álbum, el artista o los dos.', true); return; }
      web.page = 0;
      web.results = [];
      web.more = { mb: true, dg: true };
    } else web.page += 1;
    web.busy = true;
    $('#dxWebMore').hidden = true;
    setWebStatus('Buscando ediciones en MusicBrainz' + (discogsToken() ? ' y Discogs' : '') + '…');
    if (reset) $('#dxWebResults').innerHTML = '<div class="dx-empty dx-searching">🎶 Buscando portadas y ediciones…</div>';
    const jobs = [web.more.mb ? searchMusicBrainz(web.album, web.artist, web.page) : Promise.resolve(Object.assign([], { more: false })),
      web.more.dg ? searchDiscogs(web.album, web.artist, web.page) : Promise.resolve(Object.assign([], { more: false }))];
    const [mb, dg] = await Promise.allSettled(jobs);
    const errors = [];
    const add = [];
    if (mb.status === 'fulfilled') { add.push(...mb.value); web.more.mb = mb.value.more; } else { errors.push(mb.reason?.name === 'AbortError' ? 'MusicBrainz no respondió a tiempo' : String(mb.reason?.message || 'MusicBrainz falló')); web.more.mb = false; }
    if (dg.status === 'fulfilled') { add.push(...dg.value); web.more.dg = dg.value.more; } else { errors.push(dg.reason?.name === 'AbortError' ? 'Discogs no respondió a tiempo' : String(dg.reason?.message || 'Discogs falló')); web.more.dg = false; }
    // Intercala las dos fuentes para que se vean las dos desde el principio.
    const a = add.filter((x) => x.source === 'MusicBrainz');
    const b = add.filter((x) => x.source === 'Discogs');
    const mixed = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) { if (b[i]) mixed.push(b[i]); if (a[i]) mixed.push(a[i]); }
    const seen = new Set(web.results.map((r) => r.id));
    web.results.push(...mixed.filter((r) => !seen.has(r.id)));
    web.busy = false;
    paintWeb(errors);
  }
  function paintWeb(errors = []) {
    const box = $('#dxWebResults');
    box.innerHTML = web.results.length ? web.results.map((r, i) => {
      const meta = [r.year, r.country, r.format].filter(Boolean).join(' · ');
      return `<button type="button" class="dx-ed" data-dx-ed="${i}">${thumb(r.cover, r.album, r.cover_alt, 'big')}<span class="dx-ed-txt"><b>${esc(r.album || 'Sin título')}</b><span>${esc(r.artist || 'Artista desconocido')}</span>${meta ? `<small>${esc(meta)}</small>` : ''}${r.label ? `<small>${esc(r.label)}</small>` : ''}<em class="dx-src ${r.source === 'Discogs' ? 'dg' : 'mb'}">${esc(r.source)}</em></span></button>`;
    }).join('') : '<div class="dx-empty">No hemos encontrado ninguna edición con ese nombre. Prueba con menos palabras o solo con el artista.</div>';
    $('#dxWebMore').hidden = !(web.more.mb || web.more.dg);
    $('#dxWebManual').hidden = false;
    const n = web.results.length;
    setWebStatus(errors.length ? `${n ? `${plural(n, 'edición', 'ediciones')}. ` : ''}Aviso: ${errors.join(' · ')}` : n ? `${plural(n, 'edición encontrada', 'ediciones encontradas')}. Toca la que quieras.` : '', errors.length && !n);
  }
  async function pickEdition(i) {
    const r = web.results[i];
    if (!r) return;
    // Si ese álbum ya está en casa, se apunta el de casa.
    const home = discs().find((d) => nrm(d.album) === nrm(r.album) && nrm(d.artist) === nrm(r.artist));
    const snap = home ? snapshot(home) : {
      disc_key: `fuera|${r.id}`.slice(0, 600), album: r.album.slice(0, 300), artist: r.artist.slice(0, 300), category: r.category, cover: coverOk(r.cover), owners: [],
      year: r.year || null, country: r.country || null, label: r.label ? String(r.label).slice(0, 200) : null, source: r.source, source_url: coverOk(r.url), cover_alt: coverOk(r.cover_alt)
    };
    close($('#dxWeb'));
    await addPending(snap, web.person, !!home);
    if (home) toast('Ese álbum está en casa: se ha apuntado el de la colección.', 3200);
  }
  /* ---------- Escuchar en Spotify ----------
     Sin claves: Deezer (JSONP, búsqueda pública) encuentra el álbum y su primera canción,
     y Odesli/song.link (API pública) da el enlace equivalente de Spotify.
     Si algo falla, se abre la búsqueda de Spotify con el artista y el álbum. */
  const spotifyCache = new Map();
  const spotifyReady = new Map();   // resultados ya conocidos (para abrir en el mismo toque)
  const spKey = (artist, album) => `${nrm(artist)}|${nrm(album)}`;
  function jsonp(url, ms = 9000) {
    return new Promise((resolve, reject) => {
      const cb = `__dxJsonp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      const s = document.createElement('script');
      const end = (fn, v) => { clearTimeout(t); try { delete window[cb]; } catch { window[cb] = undefined; } s.remove(); fn(v); };
      const t = setTimeout(() => end(reject, new Error('Deezer no respondió a tiempo')), ms);
      window[cb] = (data) => end(resolve, data);
      s.onerror = () => end(reject, new Error('No se pudo consultar Deezer'));
      s.src = `${url}${url.includes('?') ? '&' : '?'}output=jsonp&callback=${cb}`;
      document.head.appendChild(s);
    });
  }
  async function odesli(link) {
    const res = await timed(`https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(link)}&userCountry=ES`, { headers: { Accept: 'application/json' } }, 9000);
    if (!res.ok) throw new Error(`song.link ${res.status}`);
    const js = await res.json();
    const sp = js.linksByPlatform?.spotify;
    const m = String(sp?.url || '').match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(album|track)\/([A-Za-z0-9]+)/);
    return m ? { type: m[1], id: m[2] } : null;
  }
  let officialState = 'unknown';   // 'unknown' | 'ok' | 'missing'
  async function spotifyOfficial(artist, album) {
    if (officialState === 'missing') return null;
    try {
      const cfg = await loadConfig();
      const res = await timed(`${cfg.url}/functions/v1/spotify-buscar`, { method: 'POST', headers: { apikey: cfg.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ artist, album }) }, 10000);
      if (res.status === 404) { officialState = 'missing'; return null; }
      const js = await res.json().catch(() => null);
      if (js?.code === 'sin_configurar') { officialState = 'missing'; console.warn('[Discoteca] Spotify:', js.message); return null; }
      if (!js?.ok) { if (js?.message) console.warn('[Discoteca] Spotify:', js.message); return js?.code === 'no_encontrado' ? { notFound: true } : null; }
      officialState = 'ok';
      return { albumId: js.albumId, trackId: js.trackId, title: js.albumName, firstTrack: js.trackName || '' };
    } catch (e) { console.warn('[Discoteca] Spotify (función):', e?.message || e); return null; }
  }
  const cleanTitle = (t) => nrm(t).replace(/\s*[([].*?[)\]]\s*/g, ' ').replace(/\b(deluxe|remaster(ed)?|edition|edicion|version|expanded)\b/g, ' ').replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
  async function findSpotify(artist, album) {
    const key = spKey(artist, album);
    if (spotifyCache.has(key)) return spotifyCache.get(key);
    const job = (async () => {
      // 1) Función de Supabase con la API oficial de Spotify (la más fiable, si está desplegada).
      const official = await spotifyOfficial(artist, album);
      if (official?.notFound) return null;
      if (official) return official;
      // 2) Sin la función: Deezer + song.link.
      const tries = artist ? [`artist:"${artist}" album:"${album}"`, `${artist} ${album}`] : [album];
      let hit = null;
      for (const q of tries) {
        const r = await jsonp(`https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=10`);
        const list = r?.data || [];
        hit = list.find((x) => cleanTitle(x.title) === cleanTitle(album) && (!artist || cleanTitle(x.artist?.name) === cleanTitle(artist)))
          || list.find((x) => cleanTitle(x.title).includes(cleanTitle(album)) || cleanTitle(album).includes(cleanTitle(x.title)))
          || null;
        if (hit) break;
      }
      if (!hit) return null;
      const tracks = await jsonp(`https://api.deezer.com/album/${hit.id}/tracks?limit=1`).catch(() => null);
      const first = tracks?.data?.[0];
      const [alb, trk] = await Promise.allSettled([odesli(hit.link || `https://www.deezer.com/album/${hit.id}`), first ? odesli(first.link || `https://www.deezer.com/track/${first.id}`) : Promise.resolve(null)]);
      const albumId = alb.status === 'fulfilled' && alb.value?.type === 'album' ? alb.value.id : null;
      const trackId = trk.status === 'fulfilled' && trk.value?.type === 'track' ? trk.value.id : null;
      if (!albumId && !trackId) return null;
      return { albumId, trackId, title: hit.title, firstTrack: first?.title || '' };
    })().catch((e) => { console.warn('[Discoteca] Spotify:', e?.message || e); return null; });
    spotifyCache.set(key, job);
    const out = await job;
    if (!out) spotifyCache.delete(key);   // se volverá a intentar la próxima vez
    else spotifyReady.set(key, out);
    return out;
  }
  /**
   * Abre Spotify con el enlace universal open.spotify.com: en el móvil con la app instalada se abre
   * la app; si no, el reproductor web. La ventana se abre en el mismo toque (si no, el navegador la
   * bloquearía) y se le pone la dirección cuando ya se conoce. Se puede sustituir en pruebas.
   */
  function startWindow() {
    if (window.HogarDiscosExtra?.openExternal) return null;
    try { const w = window.open('', '_blank'); if (w) { try { w.opener = null; } catch { /* nada */ } } return w; } catch { return null; }
  }
  function openExternal(url, w) {
    if (window.HogarDiscosExtra?.openExternal) return window.HogarDiscosExtra.openExternal(url);
    if (w && !w.closed) { try { w.location.href = url; return; } catch { /* sigue */ } }
    if (!w) { const n = window.open(url, '_blank', 'noopener'); if (n) return; }
    location.href = url;
  }
  async function playOnSpotify(p, pending) {
    // Si ya se encontró mientras se leía la ficha, se abre directamente (así el móvil abre la app).
    const w = spotifyReady.has(spKey(p.artist || '', p.album || '')) ? null : startWindow();
    toast('🎧 Buscando el álbum en Spotify…', 6000);
    const sp = await pending;
    if (sp?.trackId || sp?.albumId) {
      // La primera canción dentro del álbum: Spotify empieza por ella y sigue con el resto del disco.
      const url = sp.trackId
        ? `https://open.spotify.com/track/${sp.trackId}${sp.albumId ? `?context=${encodeURIComponent(`spotify:album:${sp.albumId}`)}` : ''}`
        : `https://open.spotify.com/album/${sp.albumId}`;
      toast(sp.firstTrack ? `▶️ «${sp.firstTrack}» · ${sp.title}` : `▶️ ${sp.title}`, 3500);
      openExternal(url, w);
      return;
    }
    const q = `${p.artist || ''} ${p.album || ''}`.trim();
    toast('No he encontrado el álbum exacto: te abro la búsqueda en Spotify.', 3500);
    openExternal(`https://open.spotify.com/search/${encodeURIComponent(q)}`, w);
  }

  async function openPendingItem(id) {
    const p = st.pending.find((x) => x.id === id);
    if (!p) return;
    const d = p.in_home ? discByKey(p.disc_key) : null;
    const own = p.added_by === p.person;
    // Se empieza a buscar en Spotify mientras se lee la ficha, para que el botón responda al momento.
    const spotifyJob = findSpotify(p.artist || '', p.album || '');
    const choice = await dialog({
      title: p.album || 'Sin título',
      html: `<div class="dx-dlg-disc">${thumb(coverFor(p), p.album, p.cover_alt, 'big')}<div><p><b>${esc(p.artist || 'Artista desconocido')}</b></p>${[p.year, p.category, p.country].filter(Boolean).length ? `<p class="dx-hint">${esc([p.year, p.category, p.country].filter(Boolean).join(' · '))}${p.label ? ` · ${esc(p.label)}` : ''}</p>` : ''}<p>${own ? `🎧 ${esc(p.person)} lo tiene pendiente` : `💌 ${esc(p.added_by)} se lo recomienda a <b>${esc(p.person)}</b>`} desde el ${esc(fmtDate(p.created_at))}.</p><p class="dx-hint">${p.in_home ? `Está en casa${p.owners?.length ? `: es de ${esc(p.owners.join(' y '))}` : ''}.` : 'No está en la colección de casa.'}</p>${p.source_url ? `<p><a class="dx-link" href="${esc(p.source_url)}" target="_blank" rel="noopener noreferrer">🔗 Ver la edición en ${esc(p.source || 'internet')}</a></p>` : ''}</div></div>`,
      buttons: [
        { label: '▶️ Escuchar en Spotify', value: 'spotify', kind: 'spotify' },
        { label: '🎧 Ya lo he escuchado', value: 'done', kind: 'mint' },
        ...(d && openAlbumSafe() ? [{ label: '💿 Ver el disco', value: 'see', kind: 'coral' }] : []),
        { label: '🗑 Quitar de la lista', value: 'rm', kind: 'soft' },
        { label: 'Cancelar', value: null }
      ]
    });
    if (choice === 'spotify') return playOnSpotify(p, spotifyJob);
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
      if (o) return openWeb(o.dataset.dxAddother);
      const it = t.closest('[data-dx-pend]');
      if (it) openPendingItem(it.dataset.dxPend);
    });
    $('#dxPickQ').addEventListener('input', paintPick);
    $('#dxPick').addEventListener('click', (e) => {
      if (e.target.id === 'dxPick' || e.target.closest('[data-dx-close]')) return close($('#dxPick'));
      const p = e.target.closest('[data-dx-pick]');
      if (p) onPick(p.dataset.dxPick);
    });
    $('#dxPick').addEventListener('click', (e) => {
      if (!e.target.closest('[data-dx-goweb]')) return;
      const q = $('#dxPickQ').value.trim();
      openWeb(st.pick.person, q);
    });
    $('#dxWebForm').addEventListener('submit', (e) => { e.preventDefault(); runWeb(true); });
    $('#dxWebMore').addEventListener('click', () => runWeb(false));
    $('#dxWebManual').addEventListener('click', addManual);
    $('#dxWeb').addEventListener('click', (e) => {
      if (e.target.id === 'dxWeb' || e.target.closest('[data-dx-close]')) return close($('#dxWeb'));
      const ed = e.target.closest('[data-dx-ed]');
      if (ed) pickEdition(Number(ed.dataset.dxEd));
    });
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
      if ($('#dxDialog.open')) { e.preventDefault(); endDialog(null); } else if ($('#dxName.open')) { e.preventDefault(); endName(null); } else if ($('#dxWeb.open')) { e.preventDefault(); close($('#dxWeb')); } else if ($('#dxPick.open')) { e.preventDefault(); close($('#dxPick')); }
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && activePage()) refresh(); });
    window.addEventListener('online', () => { if (activePage()) refresh(); });
  }

  function init() {
    if (!build()) return;
    injectStyles();
    bind();
    addRecommendButton();
    // Desde un aviso: index.html?abrir=discLoans o ?abrir=discPending
    const abrir = new URLSearchParams(location.search).get('abrir');
    if (abrir === 'discLoans' || abrir === 'discPending') {
      const go = () => {
        $('#enterDiscs')?.click();
        showMyPage(abrir);
        try { history.replaceState(null, '', location.pathname + location.hash); } catch { /* nada */ }
      };
      (window.HogarUser?.ready?.() || Promise.resolve()).then(() => setTimeout(go, 150));
    }
  }
  window.HogarDiscosExtra = { refresh, discKey, findSpotify };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
