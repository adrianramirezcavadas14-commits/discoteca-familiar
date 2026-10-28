/* Discohogar: controles del escáner (enfocar, foto, cambiar cámara y linterna).
   v10: usa el escáner común de Hogar (scanner-core.js) para que el enfoque funcione de verdad. */
(() => {
  const $ = (selector) => document.querySelector(selector);

  function addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .extra-camera-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:10px}
      .extra-camera-actions button{border:0;border-radius:13px;padding:11px 10px;font-weight:850;background:#fff4db;color:var(--ink);min-height:46px}
      .extra-camera-actions .photo-button{background:var(--yellow)}
      .extra-camera-actions .cam-extra{background:#fff;border:1px solid var(--line,#e6dccb)}
      .extra-camera-actions [hidden]{display:none!important}
      .extra-focus-ring{position:absolute;width:64px;height:64px;border:3px solid #ffd166;border-radius:50%;transform:translate(-50%,-50%) scale(.75);opacity:0;pointer-events:none;z-index:4;box-shadow:0 0 0 2px #0005;transition:opacity .18s,transform .18s}
      .extra-focus-ring.show{opacity:1;transform:translate(-50%,-50%) scale(1)}
      .extra-camera-tip{text-align:center;font-size:12px;color:var(--muted);margin:8px 0 0}
      #scanView{touch-action:manipulation;cursor:crosshair}
    `;
    document.head.appendChild(style);
  }

  const say = (text) => { const status = $('#scanStatus'); if (status && text) status.textContent = text; };

  async function requestFocus(event) {
    const view = $('#scanView') || $('.scan-view');
    const ring = $('#extraFocusRing');
    if (!view) return;
    const rect = view.getBoundingClientRect();
    const x = event?.clientX ?? rect.left + rect.width / 2;
    const y = event?.clientY ?? rect.top + rect.height / 2;
    ring.style.left = `${x - rect.left}px`;
    ring.style.top = `${y - rect.top}px`;
    ring.classList.add('show');
    setTimeout(() => ring.classList.remove('show'), 650);
    if (!window.HogarScanner?.isOpen()) { say('La cámara todavía no está preparada.'); return; }
    const fx = Math.min(1, Math.max(0, (x - rect.left) / rect.width));
    const fy = Math.min(1, Math.max(0, (y - rect.top) / rect.height));
    say(await window.HogarScanner.focus(fx, fy));
  }

  async function decodeFile(file) {
    if ('BarcodeDetector' in window) {
      try {
        const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
        const bitmap = await createImageBitmap(file);
        const found = await detector.detect(bitmap);
        bitmap.close?.();
        if (found[0]?.rawValue) return found[0].rawValue;
      } catch { /* se prueba con ZXing */ }
    }
    if (!window.ZXingBrowser) throw new Error('Lector no disponible');
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const reader = new ZXingBrowser.BrowserMultiFormatReader();
      return (await reader.decodeFromImageElement(image)).getText();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function readPhoto(file) {
    if (!file) return;
    say('Leyendo el código de la foto…');
    try {
      const code = String(await decodeFile(file)).replace(/\D/g, '');
      if (!code) throw new Error('Código vacío');
      // La discoteca decide si es para sumar un disco o para la lista de deseos.
      if (window.__discScanCode) { window.__discScanCode(code); return; }
      const barcodeInput = $('#fBarcode');
      if (barcodeInput) barcodeInput.value = code;
      say(`Código detectado: ${code}`);
      $('#scanModal')?.classList.remove('open');
      $('#lookupBarcode')?.click();
    } catch {
      say('No se ha podido leer el código. Acerca la cámara, evita reflejos y vuelve a intentarlo.');
    }
  }

  function installControls() {
    const view = $('.scan-view');
    const status = $('#scanStatus');
    if (!view || !status || $('#extraCameraActions')) return;

    view.id ||= 'scanView';
    const ring = document.createElement('div');
    ring.id = 'extraFocusRing';
    ring.className = 'extra-focus-ring';
    ring.setAttribute('aria-hidden', 'true');
    view.appendChild(ring);
    view.addEventListener('click', requestFocus);

    const tip = document.createElement('p');
    tip.className = 'extra-camera-tip';
    tip.textContent = 'Toca la imagen para enfocar. Si sigue borroso, aleja un poco el móvil o prueba «Cambiar cámara».';

    const actions = document.createElement('div');
    actions.id = 'extraCameraActions';
    actions.className = 'extra-camera-actions';
    actions.innerHTML = '<button type="button" id="extraFocusButton">🎯 Enfocar</button>'
      + '<button type="button" class="photo-button" id="extraPhotoButton">📸 Hacer foto</button>'
      + '<button type="button" class="cam-extra" id="extraSwitchButton" hidden>🔄 Cambiar cámara</button>'
      + '<button type="button" class="cam-extra" id="extraTorchButton" hidden>🔦 Linterna</button>';

    const input = document.createElement('input');
    input.id = 'extraBarcodePhoto';
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.hidden = true;

    status.before(tip, actions, input);
    $('#extraFocusButton').addEventListener('click', () => requestFocus());
    $('#extraPhotoButton').addEventListener('click', () => {
      input.value = '';
      input.click();
    });
    $('#extraSwitchButton').addEventListener('click', async () => {
      if (!window.HogarScanner?.isOpen()) return;
      say('Cambiando de cámara…');
      try { say(await window.HogarScanner.switchCamera()); } catch (e) { say(window.HogarScanner.errorText(e)); }
    });
    $('#extraTorchButton').addEventListener('click', async () => {
      if (window.HogarScanner) say(await window.HogarScanner.torch());
    });
    input.addEventListener('change', (event) => readPhoto(event.target.files?.[0]));
  }

  addStyles();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installControls);
  } else {
    installControls();
  }
})();
