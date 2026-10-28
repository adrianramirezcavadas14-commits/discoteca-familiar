/* =====================================================================
   HOGAR · Escáner de códigos de barras común (discos y libros)
   ---------------------------------------------------------------------
   Por qué existe: en muchos móviles Android hay varias cámaras traseras
   (principal, gran angular, macro…). Pedir solo «cámara trasera» puede
   abrir una sin enfoque automático, y sin pedir enfoque continuo la imagen
   se queda borrosa y el botón de enfocar no hace nada.

   Este módulo:
   · Elige la cámara trasera que tiene enfoque automático continuo y la
     recuerda en el dispositivo para la próxima vez.
   · Pide enfoque continuo, buena resolución y, si la cámara lo permite,
     un poco de zoom (así se puede alejar el móvil y enfocar mejor).
   · Enfocar = toque de enfoque real (single-shot) en el punto tocado.
   · Linterna y cambio de cámara cuando el móvil lo permite.
   · Lee con el lector nativo del navegador (BarcodeDetector) si existe;
     si no, con ZXing (solo formatos 1D: EAN-13, EAN-8, UPC).
   Uso: HogarScanner.start(video, onCode, { onStatus }), HogarScanner.stop(),
        HogarScanner.focus(x, y), HogarScanner.switchCamera(), HogarScanner.torch()
   ===================================================================== */
(function () {
  'use strict';
  const KEY = 'hogarCameraId';
  const BACK = /back|rear|environment|trasera|posterior|facing back|arrière|hinten/i;
  const NOT_MAIN = /ultra|wide|gran angular|macro|tele|depth|profundidad|front|frontal|user/i;
  let stream = null;
  let video = null;
  let onCode = null;
  let onStatus = () => {};
  let loopTimer = null;
  let zxingControls = null;
  let detector = null;
  let lastCode = '';
  let hits = 0;
  let busy = false;
  let torchOn = false;
  let cameras = [];
  let token = 0;

  const track = () => stream?.getVideoTracks?.()[0] || null;
  const caps = (t) => { try { return t?.getCapabilities?.() || {}; } catch { return {}; } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const store = {
    get() { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } },
    set(v) { try { localStorage.setItem(KEY, v); } catch { /* sin almacenamiento */ } }
  };

  function constraints(deviceId) {
    const video = {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      advanced: [{ focusMode: 'continuous' }]
    };
    if (deviceId) video.deviceId = { exact: deviceId };
    else video.facingMode = { ideal: 'environment' };
    return { audio: false, video };
  }
  async function open(deviceId) {
    return navigator.mediaDevices.getUserMedia(constraints(deviceId));
  }
  const stopStream = (s) => s?.getTracks().forEach((t) => t.stop());

  async function backCameras() {
    const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const back = all.filter((d) => BACK.test(d.label));
    const list = back.length ? back : all.filter((d) => !/front|frontal|user/i.test(d.label));
    // Primero las que parecen principales («camera2 0» antes que «camera2 2»).
    const num = (d) => Number((d.label.match(/(\d+)/) || [0, 99])[1]);
    return list.sort((a, b) => (NOT_MAIN.test(a.label) - NOT_MAIN.test(b.label)) || num(a) - num(b));
  }
  const hasAutofocus = (s) => {
    const c = caps(s?.getVideoTracks?.()[0]);
    return Array.isArray(c.focusMode) && c.focusMode.includes('continuous');
  };

  /** Abre la mejor cámara trasera: la recordada, o la primera con enfoque continuo. */
  async function openBest() {
    const saved = store.get();
    if (saved) {
      try { return await open(saved); } catch { store.set(''); }
    }
    let s = await open(null);
    cameras = await backCameras();
    const firstId = s.getVideoTracks()[0]?.getSettings?.().deviceId;
    // Si el navegador no informa del enfoque (iPhone, Firefox), se usa la cámara que dé el sistema.
    const reportsFocus = Array.isArray(caps(s.getVideoTracks()[0]).focusMode);
    if (hasAutofocus(s) || cameras.length < 2 || !reportsFocus) {
      if (firstId && hasAutofocus(s)) store.set(firstId);
      return s;
    }
    for (const cam of cameras) {
      if (cam.deviceId === firstId) continue;
      try {
        stopStream(s);
        s = await open(cam.deviceId);
        if (hasAutofocus(s)) { store.set(cam.deviceId); return s; }
      } catch { /* esa cámara no se puede abrir */ }
    }
    stopStream(s);
    // Ninguna tiene enfoque continuo: se recuerda la primera para no repetir la búsqueda cada vez.
    if (firstId) store.set(firstId);
    return open(firstId || null);
  }

  /** Enfoque continuo y algo de zoom si la cámara lo admite. */
  async function tune() {
    const t = track();
    if (!t) return;
    const c = caps(t);
    const adv = {};
    if (c.focusMode?.includes('continuous')) adv.focusMode = 'continuous';
    if (c.zoom && c.zoom.max >= 1.5) adv.zoom = Math.min(c.zoom.max, 1.8);
    if (Object.keys(adv).length) { try { await t.applyConstraints({ advanced: [adv] }); } catch { /* no admitido */ } }
  }

  function accept(raw) {
    const code = String(raw || '').toUpperCase().replace(/[^0-9X]/g, '');
    if (!code || busy) return;
    if (code === lastCode) hits++; else { lastCode = code; hits = 1; }
    onStatus(`Leyendo: ${code} (${hits}/2)`);
    if (hits >= 2) {
      busy = true;
      navigator.vibrate?.(120);
      const cb = onCode;
      // onCode devuelve false si el código no sirve (p. ej. no es un ISBN): se sigue leyendo.
      Promise.resolve(cb?.(code)).then((ok) => { if (ok === false) { busy = false; hits = 0; lastCode = ''; } });
    }
  }

  async function startDecoding(myToken) {
    if ('BarcodeDetector' in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.includes('ean_13')) {
          detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'].filter((f) => formats.includes(f)) });
          const tick = async () => {
            if (myToken !== token || !stream) return;
            try {
              if (video.readyState >= 2) {
                const found = await detector.detect(video);
                if (found[0]?.rawValue) accept(found[0].rawValue);
              }
            } catch { /* fotograma no válido */ }
            loopTimer = setTimeout(tick, 120);
          };
          tick();
          return;
        }
      } catch { /* se usa ZXing */ }
    }
    if (!window.ZXingBrowser) throw new Error('No se pudo cargar el lector de códigos');
    const Reader = window.ZXingBrowser.BrowserMultiFormatOneDReader || window.ZXingBrowser.BrowserMultiFormatReader;
    const reader = new Reader();
    zxingControls = await reader.decodeFromStream(stream, video, (result) => {
      if (myToken === token && result) accept(result.getText());
    });
  }

  async function start(videoEl, codeCb, opts = {}) {
    await stop();
    const myToken = ++token;
    video = videoEl;
    onCode = codeCb;
    onStatus = opts.onStatus || (() => {});
    lastCode = ''; hits = 0; busy = false; torchOn = false;
    if (!window.isSecureContext) throw Object.assign(new Error('La cámara en directo necesita https'), { name: 'SecurityError' });
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no ofrece cámara en directo');
    onStatus('Abriendo la cámara…');
    const s = await openBest();
    if (myToken !== token) { stopStream(s); return null; }
    stream = s;
    video.setAttribute('playsinline', '');
    video.muted = true;
    video.srcObject = stream;
    await video.play().catch(() => {});
    await tune();
    if (!cameras.length) { try { cameras = await backCameras(); } catch { cameras = []; } }
    await startDecoding(myToken);
    onStatus(opts.readyText || 'Apunta la cámara al código de barras.');
    return info();
  }

  async function stop() {
    token++;
    clearTimeout(loopTimer); loopTimer = null;
    try { zxingControls?.stop(); } catch { /* ya parado */ }
    zxingControls = null;
    detector = null;
    if (stream) stopStream(stream);
    stream = null;
    if (video) { try { video.pause(); } catch { /* */ } video.srcObject = null; }
  }

  /** Toque para enfocar en un punto (x, y entre 0 y 1). */
  async function focus(x = 0.5, y = 0.5) {
    const t = track();
    if (!t) return 'La cámara todavía no está preparada.';
    const c = caps(t);
    const modes = c.focusMode || [];
    try {
      if (modes.includes('single-shot')) {
        const adv = { focusMode: 'single-shot' };
        if ('pointsOfInterest' in c || 'pointsOfInterest' in (t.getSettings?.() || {})) adv.pointsOfInterest = [{ x, y }];
        await t.applyConstraints({ advanced: [adv] });
        await sleep(900);
        if (modes.includes('continuous')) await t.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
        return 'Enfocando… mantén el código dentro del rectángulo.';
      }
      if (modes.includes('continuous')) {
        // Forzar un nuevo enfoque: manual → continuo.
        if (modes.includes('manual')) await t.applyConstraints({ advanced: [{ focusMode: 'manual' }] }).catch(() => {});
        await t.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
        return 'Enfocando… si sigue borroso, aleja un poco el móvil.';
      }
    } catch { /* sigue abajo */ }
    return cameras.length > 1
      ? 'Esta cámara no permite enfocar desde la web. Prueba «Cambiar cámara».'
      : 'Este móvil no permite controlar el enfoque desde la web. Aleja un poco el móvil o usa «Hacer foto».';
  }

  /** Pasa a la siguiente cámara trasera y la recuerda. */
  async function switchCamera() {
    if (!video || !onCode) return 'La cámara no está abierta.';
    if (!cameras.length) cameras = await backCameras();
    if (cameras.length < 2) return 'Solo hay una cámara trasera disponible.';
    const current = track()?.getSettings?.().deviceId;
    const i = cameras.findIndex((c) => c.deviceId === current);
    const next = cameras[(i + 1) % cameras.length];
    store.set(next.deviceId);
    const cb = onCode;
    const st = onStatus;
    await start(video, cb, { onStatus: st });
    return `Cámara: ${next.label || 'siguiente'}`;
  }

  async function torch() {
    const t = track();
    if (!t || !caps(t).torch) return 'Este móvil no permite encender la linterna desde la web.';
    torchOn = !torchOn;
    try { await t.applyConstraints({ advanced: [{ torch: torchOn }] }); } catch { torchOn = false; return 'No se pudo encender la linterna.'; }
    return torchOn ? 'Linterna encendida.' : 'Linterna apagada.';
  }

  function info() {
    const c = caps(track());
    return { cameras: cameras.length, torch: !!c.torch, focus: (c.focusMode || []).join(','), native: !!detector };
  }

  function errorText(e) {
    const n = e?.name || '';
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'El permiso de la cámara está denegado. Actívalo en los ajustes del navegador o usa «Hacer foto».';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No se ha encontrado una cámara compatible. Usa «Hacer foto».';
    if (n === 'NotReadableError') return 'La cámara está ocupada por otra aplicación. Ciérrala y vuelve a intentarlo.';
    return `${e?.message || 'No se pudo abrir la cámara'}. Puedes usar «Hacer foto».`;
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden && stream) stop(); });

  window.HogarScanner = { start, stop, focus, switchCamera, torch, info, errorText, isOpen: () => !!stream };
})();
