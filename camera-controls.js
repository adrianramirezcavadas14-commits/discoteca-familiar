/* Discohogar: controles adicionales de enfoque y foto. */
(() => {
  const $ = (selector) => document.querySelector(selector);

  function addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .extra-camera-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:10px}
      .extra-camera-actions button{border:0;border-radius:13px;padding:11px 10px;font-weight:850;background:#fff4db;color:var(--ink)}
      .extra-camera-actions .photo-button{background:var(--yellow)}
      .extra-focus-ring{position:absolute;width:64px;height:64px;border:3px solid #ffd166;border-radius:50%;transform:translate(-50%,-50%) scale(.75);opacity:0;pointer-events:none;z-index:4;box-shadow:0 0 0 2px #0005;transition:opacity .18s,transform .18s}
      .extra-focus-ring.show{opacity:1;transform:translate(-50%,-50%) scale(1)}
      .extra-camera-tip{text-align:center;font-size:12px;color:var(--muted);margin:8px 0 0}
      #scanView{touch-action:manipulation;cursor:crosshair}
    `;
    document.head.appendChild(style);
  }

  async function requestFocus(event) {
    const view = $('#scanView') || $('.scan-view');
    const video = $('#scanVideo');
    const status = $('#scanStatus');
    const ring = $('#extraFocusRing');
    if (!view || !video) return;

    const rect = view.getBoundingClientRect();
    const x = event?.clientX ?? rect.left + rect.width / 2;
    const y = event?.clientY ?? rect.top + rect.height / 2;
    ring.style.left = `${x - rect.left}px`;
    ring.style.top = `${y - rect.top}px`;
    ring.classList.add('show');
    setTimeout(() => ring.classList.remove('show'), 650);

    const track = video.srcObject?.getVideoTracks?.()[0];
    if (!track) {
      if (status) status.textContent = 'La cámara todavía no está preparada.';
      return;
    }

    try {
      const capabilities = track.getCapabilities?.() || {};
      const modes = capabilities.focusMode || [];
      if (modes.includes('single-shot')) {
        await track.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] });
      } else if (modes.includes('continuous')) {
        await track.applyConstraints({ advanced: [{ focusMode: 'manual' }] }).catch(() => {});
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      } else {
        throw new Error('Enfoque no compatible');
      }
      if (status) status.textContent = 'Enfoque solicitado. Mantén el código dentro del rectángulo.';
    } catch {
      if (status) status.textContent = 'Este móvil no permite controlar el enfoque desde la web. Usa “Hacer foto”.';
    }
  }

  async function readPhoto(file) {
    if (!file) return;
    const status = $('#scanStatus');
    if (status) status.textContent = 'Leyendo el código de la foto…';
    let url = '';
    try {
      if (!window.ZXingBrowser) throw new Error('Lector no disponible');
      url = URL.createObjectURL(file);
      const image = new Image();
      image.src = url;
      await image.decode();
      const reader = new ZXingBrowser.BrowserMultiFormatReader();
      const result = await reader.decodeFromImageElement(image);
      const code = result.getText().replace(/\D/g, '');
      if (!code) throw new Error('Código vacío');
      const barcodeInput = $('#fBarcode');
      if (barcodeInput) barcodeInput.value = code;
      if (status) status.textContent = `Código detectado: ${code}`;
      $('#scanModal')?.classList.remove('open');
      $('#lookupBarcode')?.click();
    } catch {
      if (status) status.textContent = 'No se ha podido leer el código. Acerca la cámara, evita reflejos y vuelve a intentarlo.';
    } finally {
      if (url) URL.revokeObjectURL(url);
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
    tip.textContent = 'Toca la imagen para intentar enfocar.';

    const actions = document.createElement('div');
    actions.id = 'extraCameraActions';
    actions.className = 'extra-camera-actions';
    actions.innerHTML = '<button type="button" id="extraFocusButton">🎯 Enfocar</button><button type="button" class="photo-button" id="extraPhotoButton">📸 Hacer foto</button>';

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
    input.addEventListener('change', (event) => readPhoto(event.target.files?.[0]));
  }

  addStyles();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installControls);
  } else {
    installControls();
  }
})();
