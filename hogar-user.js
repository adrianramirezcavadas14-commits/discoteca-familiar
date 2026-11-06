/* =====================================================================
   HOGAR · USUARIO Y AVISOS (común a la discoteca, la biblioteca y la despensa)
   · Al entrar por primera vez se elige quién eres: Papá, Mamá, María, Adrián o Invitado.
     Se guarda en este dispositivo (mismo dato para las tres partes de Hogar).
   · Arriba a la derecha queda el icono del perfil: cambiar de usuario, cerrar sesión y
     probar los avisos.
   · Los usuarios de la familia tienen que permitir los avisos para entrar. Si se rechazan,
     no se entra hasta activarlos en los ajustes. Invitado no recibe avisos.
   · Sin contraseña. Sin librerías: fetch a la API REST con la publishable key.
   ===================================================================== */
(function () {
  'use strict';
  if (window.HogarUser) return;

  const USERS = [
    { name: 'Papá', color: '#ff786b' },
    { name: 'Mamá', color: '#2fae86' },
    { name: 'María', color: '#6674c7' },
    { name: 'Adrián', color: '#e5a93d' },
    { name: 'Invitado', color: '#8a8f9c', guest: true }
  ];
  const KEY = 'hogarUsuario';
  const SCRIPT = document.currentScript?.src || location.href;
  const BASE = new URL('.', SCRIPT);              // carpeta raíz de Hogar
  const st = { user: null, cfg: null, pushState: 'unknown', pushError: '', endpoint: null, listeners: new Set() };
  let readyResolve;
  const ready = new Promise((r) => { readyResolve = r; });

  const $ = (q, el = document) => el.querySelector(q);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
  const userInfo = (name) => USERS.find((u) => u.name === name) || null;
  const initial = (name) => (String(name || '?').normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[A-Za-z]/)?.[0] || '?').toUpperCase();

  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  /* ---------- Supabase ---------- */
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
      s.src = new URL('libros/supabase-config.js', BASE).href;
      s.onload = () => (pick() ? resolve(st.cfg) : reject(new Error('Falta la configuración de Supabase.')));
      s.onerror = () => reject(new Error('No se pudo cargar la configuración.'));
      document.head.appendChild(s);
    });
  }
  async function call(path, { method = 'POST', body = null } = {}) {
    const cfg = await loadConfig();
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 12000);
    try {
      const res = await fetch(`${cfg.url}${path}`, { method, headers: { apikey: cfg.key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : null, cache: 'no-store', signal: c.signal });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) throw Object.assign(new Error(data?.message || `Error ${res.status}`), { status: res.status, code: data?.code });
      return data;
    } finally { clearTimeout(t); }
  }
  const rpc = (name, args) => call(`/rest/v1/rpc/${name}`, { body: args });

  async function vapidKey() {
    const cached = lsGet('hogarVapid');
    if (cached) return cached;
    let k = null;
    try { k = await rpc('hogar_push_public_key', {}); } catch { k = null; }
    if (!k) { const r = await call('/functions/v1/hogar-push?action=key', { method: 'GET' }); k = r?.publicKey || null; }
    if (!k) throw new Error('Los avisos todavía no están preparados en Supabase (falta la función hogar-push).');
    lsSet('hogarVapid', k);
    return k;
  }
  const keyBytes = (b64) => { const t = b64.replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4)); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); };
  const toB64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  function swReady(ms = 10000) {
    return Promise.race([navigator.serviceWorker.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('El servicio de Hogar no ha arrancado en este navegador.')), ms))]);
  }

  /** Prepara el servicio y la clave antes de pedir permiso (en iPhone, suscribirse tiene que ir pegado al toque). */
  async function prepare() {
    try { st.reg = await swReady(); st.vapid = await vapidKey(); } catch (e) { st.prepError = e; }
  }
  async function register(sub) {
    const j = sub.toJSON();
    st.endpoint = j.endpoint;
    await rpc('hogar_push_register', { p_person: st.user, p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent.slice(0, 400) });
    st.pushState = 'ok';
    st.pushError = '';
  }
  /** Suscribe este dispositivo y lo registra para el usuario actual. */
  async function subscribeAndRegister() {
    const reg = st.reg || await swReady();
    st.reg = reg;
    let sub = await reg.pushManager.getSubscription();
    const key = st.vapid || await vapidKey();
    st.vapid = key;
    if (sub) {
      // Si la suscripción es de otra clave (por ejemplo, se rehicieron las claves), se rehace.
      const k = sub.options?.applicationServerKey;
      if (k && toB64u(k) !== key) { await sub.unsubscribe().catch(() => {}); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    await register(sub);
  }
  async function unregisterDevice() {
    try {
      const reg = await swReady(4000);
      const sub = await reg.pushManager.getSubscription();
      if (sub) await rpc('hogar_push_unregister', { p_endpoint: sub.endpoint }).catch(() => {});
    } catch { /* sin servicio */ }
    st.pushState = 'off';
  }

  /* ---------- Estilos ---------- */
  function injectStyles() {
    if ($('#hgStyles')) return;
    const el = document.createElement('style');
    el.id = 'hgStyles';
    el.textContent = `
#hgGate{position:fixed;inset:0;z-index:5000;display:grid;place-items:center;padding:18px;background:radial-gradient(circle at 20% 10%,#ffe1a8 0,transparent 40%),radial-gradient(circle at 90% 90%,#bfe6ff 0,transparent 45%),#fff8eb;overflow:auto;font:16px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#243047}
#hgGate *{box-sizing:border-box}
#hgGate .hg-box{width:min(520px,100%);background:#fffdf8;border-radius:28px;padding:26px 22px;box-shadow:0 22px 60px #4b3b2630;text-align:center}
#hgGate .hg-ico{font-size:52px;line-height:1;margin-bottom:8px}
#hgGate h2{margin:0 0 6px;font-size:clamp(24px,6vw,30px)}
#hgGate p{margin:0 0 14px;color:#687086}
#hgGate .hg-users{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:8px}
#hgGate .hg-user{appearance:none;display:flex;align-items:center;gap:10px;border:2px solid #efe6d6;border-radius:18px;background:#fff;padding:12px;font:inherit;font-weight:900;font-size:17px;color:#243047;cursor:pointer;min-height:60px;text-align:left}
#hgGate .hg-user:hover,#hgGate .hg-user:focus-visible{border-color:var(--c);outline:0;transform:translateY(-1px)}
#hgGate .hg-user.guest{grid-column:1/-1;justify-content:center;color:#687086}
#hgGate .hg-user.current{border-color:var(--c);background:color-mix(in srgb,var(--c) 10%,#fff)}
.hg-av{display:inline-grid;place-items:center;flex:0 0 auto;width:38px;height:38px;border-radius:50%;background:var(--c,#8a8f9c);color:#fff;font-weight:950;font-size:17px;line-height:1;box-shadow:0 2px 6px #0002}
#hgGate .hg-btn{appearance:none;border:0;border-radius:15px;padding:13px 18px;min-height:50px;font:inherit;font-weight:900;cursor:pointer;background:#ff786b;color:#fff;width:100%;margin-top:8px;font-size:17px}
#hgGate .hg-btn.grey{background:#f1ece3;color:#243047}
#hgGate .hg-steps{text-align:left;background:#f8f5ef;border-radius:16px;padding:12px 14px 12px 34px;margin:0 0 12px;color:#243047}
#hgGate .hg-steps li{margin:4px 0}
#hgGate .hg-err{color:#c0392b;font-weight:800;min-height:1.2em;margin:8px 0 0}
#hgGate .hg-cancel{appearance:none;border:0;background:transparent;color:#687086;font:inherit;font-weight:800;text-decoration:underline;margin-top:12px;cursor:pointer;padding:8px}
.hg-prof{appearance:none;border:0;background:transparent;padding:2px;margin-left:8px;flex:0 0 auto;cursor:pointer;border-radius:50%;position:relative;z-index:5}
.hg-prof .hg-av{width:40px;height:40px;border:3px solid #fff}
.hg-prof:focus-visible{outline:3px solid #ff786b;outline-offset:2px}
.hg-prof.floating{position:absolute;top:14px;right:14px;z-index:30;margin:0}
.hg-prof .hg-dot{position:absolute;right:0;bottom:0;width:13px;height:13px;border-radius:50%;border:2px solid #fff;background:#2fae86}
.hg-prof .hg-dot.warn{background:#e5a93d}
.hg-prof .hg-dot.off{background:#b8bcc6}
#hgMenu{position:fixed;z-index:4800;width:min(300px,calc(100vw - 24px));background:#fffdf8;border-radius:20px;box-shadow:0 18px 50px #2430473a;padding:14px;font:15px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#243047;border:1px solid #efe6d6}
#hgMenu[hidden]{display:none}
#hgMenu .hg-me{display:flex;align-items:center;gap:10px;padding-bottom:10px;border-bottom:1px solid #efe6d6;margin-bottom:8px}
#hgMenu .hg-me small{display:block;color:#687086;font-size:12px;font-weight:800}
#hgMenu .hg-status{font-size:13px;color:#687086;margin:0 0 8px;font-weight:700}
#hgMenu .hg-status.warn{color:#9a5b00}
#hgMenu button.hg-item{appearance:none;display:flex;align-items:center;gap:10px;width:100%;border:0;border-radius:12px;background:transparent;padding:11px 10px;font:inherit;font-weight:850;color:#243047;cursor:pointer;text-align:left;min-height:44px}
#hgMenu button.hg-item:hover,#hgMenu button.hg-item:focus-visible{background:#f8f2e6;outline:0}
#hgMenu button.hg-item.danger{color:#b23b36}
html.hg-locked,html.hg-locked body{overflow:hidden!important}`;
    document.head.appendChild(el);
  }

  /* ---------- Pantalla de entrada ---------- */
  function gate(html) {
    injectStyles();
    let g = $('#hgGate');
    if (!g) {
      g = document.createElement('div');
      g.id = 'hgGate';
      g.setAttribute('role', 'dialog');
      g.setAttribute('aria-modal', 'true');
      document.body.appendChild(g);
    }
    g.innerHTML = `<div class="hg-box">${html}</div>`;
    document.documentElement.classList.add('hg-locked');
    return g;
  }
  function closeGate() { $('#hgGate')?.remove(); document.documentElement.classList.remove('hg-locked'); }

  function pickUser({ cancellable = false } = {}) {
    return new Promise((resolve) => {
      const g = gate(`<div class="hg-ico">🏡</div><h2>¿Quién eres?</h2><p>Elige tu usuario de Hogar. Se usa para enviarte los avisos que son para ti. Podrás cambiarlo desde el icono de arriba a la derecha.</p>
        <div class="hg-users">${USERS.map((u) => `<button type="button" class="hg-user${u.guest ? ' guest' : ''}${u.name === st.user ? ' current' : ''}" style="--c:${u.color}" data-hg-user="${esc(u.name)}"><span class="hg-av" style="--c:${u.color}">${u.guest ? '👤' : esc(initial(u.name))}</span>${esc(u.name)}${u.guest ? ' <small style="font-weight:700">(sin avisos)</small>' : ''}</button>`).join('')}</div>
        ${cancellable ? '<button type="button" class="hg-cancel" data-hg-cancel>Cancelar</button>' : ''}`);
      g.onclick = (e) => {
        const b = e.target.closest('[data-hg-user]');
        if (b) { g.onclick = null; resolve(b.dataset.hgUser); return; }
        if (e.target.closest('[data-hg-cancel]')) { g.onclick = null; closeGate(); resolve(null); }
      };
      setTimeout(() => g.querySelector('.hg-user')?.focus(), 50);
    });
  }

  function setUser(name) {
    st.user = name;
    lsSet(KEY, name);
    paintProfile();
    st.listeners.forEach((fn) => { try { fn(name); } catch (e) { console.error(e); } });
    window.dispatchEvent(new CustomEvent('hogar-user', { detail: { user: name } }));
  }

  function installSteps() {
    return `<ol class="hg-steps"><li>Abre Hogar en <b>Safari</b>.</li><li>Pulsa <b>Compartir</b> (el cuadrado con la flecha ↑).</li><li>Elige <b>«Añadir a pantalla de inicio»</b>.</li><li>Abre Hogar desde su icono y vuelve a entrar.</li></ol>`;
  }
  function deniedSteps() {
    if (isIOS()) return `<ol class="hg-steps"><li>Abre <b>Ajustes</b> del iPhone o iPad.</li><li>Entra en <b>Notificaciones</b> → <b>Hogar</b>.</li><li>Activa <b>Permitir notificaciones</b>.</li><li>Vuelve aquí y pulsa «Ya las he activado».</li></ol>`;
    if (/Android/i.test(navigator.userAgent)) return `<ol class="hg-steps"><li>Mantén pulsado el icono de <b>Hogar</b> → <b>Información de la app</b> (o Ajustes → Aplicaciones → Hogar/Chrome).</li><li>Entra en <b>Notificaciones</b> y actívalas.</li><li>Si usas Hogar en Chrome: toca el candado junto a la dirección → <b>Permisos</b> → <b>Notificaciones: Permitir</b>.</li><li>Vuelve aquí y pulsa «Ya las he activado».</li></ol>`;
    return `<ol class="hg-steps"><li>Haz clic en el <b>candado</b> (o el icono de ajustes) junto a la dirección.</li><li>En <b>Notificaciones</b>, elige <b>Permitir</b>.</li><li>Comprueba que las notificaciones del navegador están activadas en los ajustes del ordenador.</li><li>Pulsa «Ya las he activado».</li></ol>`;
  }

  /** Comprueba los avisos. Solo se sale de aquí con avisos permitidos (o como Invitado). */
  async function ensurePush() {
    let deniedTries = 0;
    for (;;) {
      if (!st.user || userInfo(st.user)?.guest) { st.pushState = 'guest'; return; }
      if (!pushSupported()) {
        if (isIOS() && !isStandalone()) {
          const r = await gateChoice(`<div class="hg-ico">📲</div><h2>Instala Hogar para entrar</h2><p>En iPhone y iPad los avisos solo funcionan con Hogar en la pantalla de inicio.</p>${installSteps()}`, [{ label: 'Cambiar de usuario', value: 'switch', grey: true }]);
          if (r.value === 'switch') { await switchUser(true); continue; }
        }
        // Navegador sin avisos (muy antiguo): se entra igual, pero se avisa en el perfil.
        st.pushState = 'unsupported';
        st.pushError = 'Este navegador no puede recibir avisos.';
        return;
      }
      const perm = Notification.permission;
      if (perm === 'granted') {
        try { await subscribeAndRegister(); } catch (e) {
          if (e?.name === 'NotAllowedError' && st.reg && st.vapid) {
            // Safari pide que la suscripción vaya justo después de un toque.
            const r = await gateChoice(`<div class="hg-ico">🔔</div><h2>Un último paso</h2><p>Pulsa para terminar de activar los avisos en este dispositivo.</p>`, [{ label: '🔔 Terminar de activar', value: 'sub', press: () => st.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(st.vapid) }) }, { label: 'Cambiar de usuario', value: 'switch', grey: true }]);
            if (r.value === 'switch') { await switchUser(true); continue; }
            try { await register(await r.pressed); return; } catch (e2) { st.pushError = e2?.message || String(e2); }
          }
          // Problema técnico (sin conexión, falta la función…): se entra y se reintenta al volver.
          st.pushState = 'error';
          st.pushError = st.pushError || e?.message || String(e);
          console.warn('[Hogar] Avisos:', st.pushError);
        }
        return;
      }
      if (perm === 'default') {
        await prepare();
        const r = await gateChoice(`<div class="hg-ico">🔔</div><h2>Activa los avisos de Hogar</h2><p>Hola, ${esc(st.user)}. Para entrar, permite que Hogar te avise de lo que es para ti: solicitudes de préstamo, recomendaciones, recordatorios de préstamos y novedades.</p>`, [
          { label: '🔔 Activar notificaciones', value: 'ask', press: () => askAndSubscribe() },
          { label: 'Cambiar de usuario', value: 'switch', grey: true }]);
        if (r.value === 'switch') { await switchUser(true); continue; }
        try {
          const sub = await r.pressed;
          if (sub) { await register(sub); return; }
        } catch (e) { console.warn('[Hogar] Avisos:', e?.message || e); }
        continue;
      }
      // Denegados
      const r = await gateChoice(`<div class="hg-ico">🔕</div><h2>Los avisos están desactivados</h2><p>Sin avisos no se puede entrar como ${esc(st.user)}. Actívalos así:</p>${deniedSteps()}`, [{ label: 'Ya las he activado', value: 'retry' }, { label: 'Cambiar de usuario', value: 'switch', grey: true }], deniedTries ? 'Siguen desactivadas. Revisa los ajustes y vuelve a probar.' : '');
      if (r.value === 'switch') { await switchUser(true); continue; }
      deniedTries += 1;
    }
  }
  /** Pide permiso y, si se concede, se suscribe enseguida (todo dentro del mismo toque). */
  function askAndSubscribe() {
    const ask = Notification.requestPermission ? Notification.requestPermission() : Promise.resolve(Notification.permission);
    return Promise.resolve(ask).then((perm) => {
      if (perm !== 'granted') return null;
      if (!st.reg || !st.vapid) return null;   // se terminará en el siguiente paso
      return st.reg.pushManager.getSubscription().then((old) => old || st.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(st.vapid) }));
    });
  }
  function gateChoice(html, buttons, error = '') {
    return new Promise((resolve) => {
      const g = gate(`${html}${buttons.map((b, i) => `<button type="button" class="hg-btn${b.grey ? ' grey' : ''}" data-hg-choice="${i}">${esc(b.label)}</button>`).join('')}<p class="hg-err" role="alert">${esc(error)}</p>`);
      g.onclick = (e) => {
        const el = e.target.closest('[data-hg-choice]');
        if (!el) return;
        const b = buttons[Number(el.dataset.hgChoice)];
        g.onclick = null;
        let pressed = null;
        if (b.press) { try { pressed = b.press(); } catch (err) { pressed = Promise.reject(err); } }
        if (pressed) pressed.catch(() => {});
        resolve({ value: b.value, pressed });
      };
      setTimeout(() => g.querySelector('.hg-btn')?.focus(), 50);
    });
  }

  /* ---------- Cambiar de usuario y cerrar sesión ---------- */
  async function switchUser(fromGate = false) {
    const prev = st.user;
    const name = await pickUser({ cancellable: !fromGate && !!prev });
    if (!name) { if (!fromGate) closeGate(); return prev; }
    if (name !== prev && userInfo(name)?.guest) await unregisterDevice();
    setUser(name);
    if (!fromGate) { await ensurePush(); closeGate(); paintProfile(); }
    return name;
  }
  async function logout() {
    closeMenu();
    await unregisterDevice();
    st.user = null;
    lsSet(KEY, null);
    paintProfile();
    window.dispatchEvent(new CustomEvent('hogar-user', { detail: { user: null } }));
    await start();
  }

  /* ---------- Icono del perfil ---------- */
  function profileHtml() {
    const u = userInfo(st.user);
    if (!u) return '';
    const dot = u.guest ? 'off' : st.pushState === 'ok' ? '' : 'warn';
    return `<span class="hg-av" style="--c:${u.color}">${u.guest ? '👤' : esc(initial(u.name))}</span><span class="hg-dot ${dot}" aria-hidden="true"></span>`;
  }
  function mountProfile() {
    const targets = [];
    const header = $('header.top');
    if (header) targets.push({ el: header, floating: false });
    const picker = $('#homePicker');
    if (picker) targets.push({ el: picker, floating: true });
    for (const t of targets) {
      if (t.el.querySelector(':scope > .hg-prof')) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `hg-prof${t.floating ? ' floating' : ''}`;
      b.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(b); });
      t.el.appendChild(b);
    }
    paintProfile();
  }
  function paintProfile() {
    document.querySelectorAll('.hg-prof').forEach((b) => {
      b.hidden = !st.user;
      b.innerHTML = profileHtml();
      b.setAttribute('aria-label', st.user ? `Perfil: ${st.user}. Cambiar de usuario o cerrar sesión` : 'Perfil');
      b.title = st.user ? `Has entrado como ${st.user}` : '';
    });
  }
  function statusText() {
    if (!st.user) return '';
    if (userInfo(st.user)?.guest) return { t: 'Como Invitado no recibes avisos.', warn: false };
    if (st.pushState === 'ok') return { t: '🔔 Avisos activados en este dispositivo.', warn: false };
    if (st.pushState === 'error') return { t: `⚠️ Avisos sin registrar: ${st.pushError}`, warn: true };
    if (st.pushState === 'unsupported') return { t: '⚠️ Este navegador no puede recibir avisos.', warn: true };
    return { t: 'Comprobando los avisos…', warn: false };
  }
  function toggleMenu(anchor) {
    injectStyles();
    let m = $('#hgMenu');
    if (m && !m.hidden) { closeMenu(); return; }
    if (!m) {
      m = document.createElement('div');
      m.id = 'hgMenu';
      m.setAttribute('role', 'menu');
      document.body.appendChild(m);
      m.addEventListener('click', onMenu);
      document.addEventListener('click', (e) => { if (!e.target.closest('#hgMenu, .hg-prof')) closeMenu(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
    }
    const u = userInfo(st.user);
    const s = statusText();
    const guest = !!u?.guest;
    m.innerHTML = `<div class="hg-me"><span class="hg-av" style="--c:${u?.color}">${guest ? '👤' : esc(initial(st.user))}</span><div><small>Has entrado como</small><b>${esc(st.user || '')}</b></div></div>
      <p class="hg-status ${s.warn ? 'warn' : ''}" id="hgStatus">${esc(s.t)}</p>
      ${!guest && st.pushState !== 'ok' ? '<button type="button" class="hg-item" role="menuitem" data-hg-act="retry">🔄 Volver a activar los avisos</button>' : ''}
      ${!guest && st.pushState === 'ok' ? '<button type="button" class="hg-item" role="menuitem" data-hg-act="test">🔔 Probar un aviso</button>' : ''}
      <button type="button" class="hg-item" role="menuitem" data-hg-act="switch">🔁 Entrar con otro usuario</button>
      <button type="button" class="hg-item danger" role="menuitem" data-hg-act="logout">🚪 Cerrar sesión</button>`;
    m.hidden = false;
    const r = anchor.getBoundingClientRect();
    m.style.top = `${Math.round(r.bottom + 8)}px`;
    m.style.right = `${Math.max(12, Math.round(window.innerWidth - r.right))}px`;
    setTimeout(() => m.querySelector('button')?.focus(), 30);
  }
  function closeMenu() { const m = $('#hgMenu'); if (m) m.hidden = true; }
  async function onMenu(e) {
    const b = e.target.closest('[data-hg-act]');
    if (!b) return;
    const act = b.dataset.hgAct;
    const status = $('#hgStatus');
    if (act === 'switch') { closeMenu(); await switchUser(false); return; }
    if (act === 'logout') return logout();
    if (act === 'retry') {
      status.textContent = 'Activando…';
      closeMenu();
      await ensurePush();
      closeGate();
      paintProfile();
      return;
    }
    if (act === 'test') {
      status.textContent = 'Enviando un aviso de prueba…';
      try {
        const reg = await swReady(4000);
        const sub = await reg.pushManager.getSubscription();
        const r = await rpc('hogar_push_test', { p_endpoint: sub?.endpoint || '' });
        status.textContent = r?.ok ? '✅ Enviado. Debería llegarte en unos segundos.' : `⚠️ ${r?.message || 'No se pudo enviar.'}`;
      } catch (err) { status.textContent = `⚠️ ${err.message}`; }
    }
  }

  /* ---------- Arranque ---------- */
  async function start() {
    if (!st.user || !userInfo(st.user)) {
      const name = await pickUser();
      setUser(name);
    }
    await ensurePush();
    closeGate();
    paintProfile();
    readyResolve(st.user);
  }

  // Al volver a la app (por ejemplo, tras activar los avisos en Ajustes) se comprueba otra vez.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !st.user || userInfo(st.user)?.guest) return;
    if (pushSupported() && Notification.permission === 'denied') { start(); return; }
    if (st.pushState === 'error' && pushSupported() && Notification.permission === 'granted') subscribeAndRegister().then(paintProfile).catch(() => {});
  });

  // El navegador renovó la suscripción: se registra otra vez.
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener?.('message', (e) => {
    if (e.data?.type === 'hogar-push-renew' && st.user && !userInfo(st.user)?.guest && Notification.permission === 'granted') subscribeAndRegister().then(paintProfile).catch(() => {});
  });

  st.user = userInfo(lsGet(KEY)) ? lsGet(KEY) : null;
  window.HogarUser = {
    get: () => st.user,
    isGuest: () => !!userInfo(st.user)?.guest,
    users: () => USERS.map((u) => ({ ...u })),
    colorOf: (n) => userInfo(n)?.color || null,
    ready: () => ready,
    switchUser: () => switchUser(false),
    onChange: (fn) => { st.listeners.add(fn); return () => st.listeners.delete(fn); },
    _state: st
  };
  function init() { injectStyles(); mountProfile(); start(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
