/* =====================================================================
   HOGAR · BOTÓN «ATRÁS» DEL MÓVIL (común a la discoteca, la biblioteca y la despensa)
   · Atrás cierra primero la ventana que esté abierta (ficha, buscador, menú…) y después
     vuelve a la pantalla anterior, como en una web.
   · Cuando el siguiente «atrás» sacaría de la aplicación, sale abajo un aviso gris:
     «Pulsa otra vez atrás para salir». Solo si se vuelve a pulsar en unos segundos, se sale.
   · Cada aplicación llama a HogarBack.init({...}) con cómo saber y cambiar la pantalla.
   ===================================================================== */
(function () {
  'use strict';
  if (window.HogarBack) return;

  const MODALS = '.modal.open, .scan-modal.open, .drawer-bg.open, #buzon.open, #bzNews, #hgMenu:not([hidden])';
  const EXIT_MS = 2600;
  let cfg = null;
  let top = null;            // estado de la entrada de historial en la que estamos
  let ignorePops = 0;        // «atrás» lanzados por nosotros (para quitar entradas de ventanas cerradas)
  let applying = false;      // estamos ajustando la pantalla tras un «atrás»
  let lastExitPrompt = 0;
  let order = [];            // ventanas abiertas, en orden de apertura
  let scheduled = false;

  const openModals = () => [...document.querySelectorAll(MODALS)].filter((el) => el.id !== 'hgGate');
  const gateOpen = () => !!document.getElementById('hgGate');
  const pageNow = () => { try { return cfg.getPage ? cfg.getPage() : null; } catch { return null; } };
  const snapshot = () => ({ hb: 'app', page: pageNow(), modals: order.length, url: location.href });

  function refreshOrder() {
    const now = openModals();
    order = order.filter((el) => now.includes(el));
    for (const el of now) if (!order.includes(el)) order.push(el);
  }

  /** Cierra una ventana como lo haría la persona (botón de cerrar, fondo o Escape). */
  function closeEl(el) {
    const isOpen = () => el.isConnected && el.matches(MODALS);
    const btn = el.querySelector(':scope .scan-close, :scope .x, :scope > .drawer .close, :scope [data-bz-close], :scope [data-dx-close], :scope #bznOk, :scope .hg-close');
    if (btn) btn.click();
    if (isOpen() && el.id === 'hgMenu') el.hidden = true;
    if (isOpen()) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));   // clic en el fondo
    if (isOpen()) {
      const cancel = [...el.querySelectorAll('button')].find((b) => /^(cancelar|cerrar|ahora no)$/i.test(b.textContent.trim()));
      if (cancel) cancel.click();
    }
    if (isOpen()) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (isOpen()) el.classList.remove('open');
  }

  /** La pantalla ha cambiado sola (la persona ha tocado algo): se ajusta el historial. */
  function sync() {
    scheduled = false;
    if (!cfg || applying) return;
    refreshOrder();
    const s = snapshot();
    if (!top) return;
    const samePage = cfg.mode === 'hash' || s.page === top.page;
    if (samePage) {
      if (s.modals > top.modals) {
        for (let i = top.modals + 1; i <= s.modals; i++) history.pushState({ ...s, modals: i }, '');
      } else if (s.modals < top.modals) {
        // Ventana cerrada con su botón: la entrada se reaprovecha para la pantalla actual. Si después
        // un «atrás» cae en una entrada que ya no cambia nada, se salta sola (ver onPop).
        history.replaceState(s, '');
      }
    } else if (top.modals > 0) {
      // Por ejemplo: se elige una sección en el menú lateral (se cierra el menú y cambia la pantalla).
      history.replaceState(s, '');
    } else {
      history.pushState(s, '');
    }
    top = s;
  }
  // El observador ya agrupa los cambios de un mismo toque: se ajusta en cuanto termina.
  function schedule() { if (!scheduled) { scheduled = true; queueMicrotask(sync); } }

  function exitToast() {
    let t = document.getElementById('hbExit');
    if (!t) {
      t = document.createElement('div');
      t.id = 'hbExit';
      t.setAttribute('role', 'status');
      t.style.cssText = 'position:fixed;left:50%;bottom:calc(22px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:6000;background:#4a4f5a;color:#fff;padding:11px 18px;border-radius:999px;font:700 14px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;box-shadow:0 8px 24px #0004;max-width:calc(100vw - 32px);text-align:center;opacity:0;transition:opacity .2s;pointer-events:none';
      document.body.appendChild(t);
    }
    t.textContent = `Pulsa otra vez atrás para salir${cfg.appName ? ` de ${cfg.appName}` : ''}`;
    t.style.opacity = '1';
    clearTimeout(exitToast.timer);
    exitToast.timer = setTimeout(() => { t.style.opacity = '0'; }, EXIT_MS);
  }

  function onPop(e) {
    if (ignorePops > 0) { ignorePops--; return; }
    const st = e.state;
    if (st && st.hb === 'root') {
      // Lo siguiente sería salir.
      if (Date.now() - lastExitPrompt < EXIT_MS) {
        document.getElementById('hbExit')?.style.setProperty('opacity', '0');
        history.back();
        return;
      }
      lastExitPrompt = Date.now();
      // Si había ventanas abiertas (no debería), se cierran.
      applying = true;
      refreshOrder();
      [...order].reverse().forEach(closeEl);
      applying = false;
      refreshOrder();
      top = snapshot();
      history.pushState(top, '');
      exitToast();
      return;
    }
    applying = true;
    let changed = !!top && location.href !== top.url;   // la dirección ha cambiado (pantallas por #)
    try {
      refreshOrder();
      const wantModals = st && st.hb === 'app' ? st.modals : 0;
      // 1) Se cierran las ventanas que sobran (la última abierta primero).
      let guard = 10;
      while (order.length > wantModals && guard-- > 0) {
        closeEl(order[order.length - 1]);
        refreshOrder();
        changed = true;
      }
      // 2) Se vuelve a la pantalla de esa entrada.
      if (st && st.hb === 'app' && cfg.mode !== 'hash' && st.page && st.page !== pageNow() && cfg.showPage) { cfg.showPage(st.page); changed = true; }
    } finally {
      // Entrada que ya no cambia nada (de una ventana cerrada con su botón): se salta.
      if (!changed && st && st.hb === 'app') { applying = false; history.back(); return; }
      setTimeout(() => {
        applying = false;
        refreshOrder();
        top = st && st.hb === 'app' ? { ...st, page: cfg.mode === 'hash' ? pageNow() : st.page, modals: Math.min(st.modals, order.length) } : snapshot();
        try { history.replaceState(top, ''); } catch { /* nada */ }
      }, 0);
    }
  }

  function init(options) {
    if (cfg) return;
    cfg = { mode: 'pages', ...options };
    refreshOrder();
    const first = snapshot();
    try {
      history.replaceState({ hb: 'root' }, '');
      history.pushState(first, '');
    } catch { return; }
    top = first;
    window.addEventListener('popstate', onPop);
    new MutationObserver(schedule).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  }

  window.HogarBack = { init, sync: schedule };
})();
