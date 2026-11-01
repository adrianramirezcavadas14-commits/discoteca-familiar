/* =====================================================================
   «Menú semanal» · Comidas y cenas de lunes a domingo
   · Al entrar se ve la semana actual (y cambia sola cada lunes a medianoche).
   · ‹ semana anterior · semana siguiente › : nada se borra.
   · Recetas de comida y de cena por separado; una receta solo está en las dos
     categorías si se ha usado en las dos.
   · Receta nueva: se buscan imágenes (5 + «cargar más») en el servidor y la
     imagen es obligatoria. Al reutilizarla se usa la imagen guardada.
   ===================================================================== */
import { S } from '../data/store.js';
import { explainError } from '../data/api.js';
import { loadMenuWeek, refreshRecipes, menuFor, addMenuEntry, removeMenuEntry, recipesFor, searchRecipeImages, uploadRecipeImage } from '../data/plans.js';
import { openPanel, closePanel } from '../ui/cards.js';
import { toast, dialog, confirmDialog } from '../ui/dom.js';
import { broadcast } from '../ui/nav.js';
import { esc, norm, collator, debounce, recipeKey } from '../core/text.js';
import { mondayOf, addDays, weekDays, isoDate, isoWeek, weekRangeLabel, msToMidnight, dayLabel, parseIso, DAY_NAMES } from '../core/week.js';

const SLOT_LABEL = { comida: 'Comida', cena: 'Cena' };
const ui = { offset: 0, loading: false, error: '', timer: null };

const currentMonday = () => mondayOf(new Date());
const shownMonday = () => addDays(currentMonday(), ui.offset * 7);

export function render(el) {
  el.innerHTML = `<div class="hero"><div><h2 id="h-menu">Menú semanal</h2><p>Las comidas y cenas de la semana. Toca «Comida» o «Cena» para elegir una receta.</p></div></div><div data-body></div>`;
  bind(el);
  scheduleMidnight(el);
  paint(el);
  load(el);
}
export function update(el, params, what) {
  if (['menu', 'all', 'queue'].includes(what)) paint(el);
}
export function leave() { clearTimeout(ui.timer); ui.timer = null; }

/** A medianoche se vuelve a pintar: el lunes aparece sola la semana nueva (la anterior sigue con ‹). */
function scheduleMidnight(el) {
  clearTimeout(ui.timer);
  ui.timer = setTimeout(() => { if (el.classList.contains('active')) { paint(el); load(el); } scheduleMidnight(el); }, msToMidnight());
}

async function load(el, force = false) {
  const monday = isoDate(shownMonday());
  ui.loading = !S.menuWeeks.has(monday);
  if (ui.loading) paint(el);
  try {
    if (!S.recipes.size || force) await refreshRecipes(false);
    await loadMenuWeek(monday, { force });
    ui.error = '';
  } catch (e) { ui.error = explainError(e); }
  ui.loading = false;
  if (el.classList.contains('active')) paint(el);
}

function entryHtml(e) {
  const r = S.recipes.get(e.recipe_id);
  return `<li class="menu-entry">
    <span class="me-img">${r?.image_url ? `<img src="${esc(r.image_url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '<span aria-hidden="true">🍽️</span>'}</span>
    <span class="me-name">${esc(r?.name || 'Receta')}</span>
    <button type="button" class="me-del" data-del="${esc(e.id)}" aria-label="Quitar ${esc(r?.name || 'receta')}">×</button>
  </li>`;
}

function paint(el) {
  const body = el.querySelector('[data-body]');
  const monday = shownMonday();
  const days = weekDays(monday);
  const { week, year } = isoWeek(monday);
  const range = weekRangeLabel(monday);
  const today = isoDate(new Date());
  const offline = !navigator.onLine || !S.serverOk;
  body.innerHTML = `
    <nav class="week-nav" aria-label="Cambiar de semana">
      <button type="button" class="wk-arrow" data-week="-1" aria-label="Semana anterior">‹</button>
      <div class="wk-current">
        <strong>Semana ${week}${year !== monday.getFullYear() ? ` de ${year}` : ''}</strong>
        <span><span class="wk-label">Lunes</span> ${esc(range.monday)} — <span class="wk-label">domingo</span> ${esc(range.sunday)}</span>
        ${ui.offset ? '<button type="button" class="btn small ghost" data-week="0">Ir a esta semana</button>' : '<small class="muted">Semana actual</small>'}
      </div>
      <button type="button" class="wk-arrow" data-week="1" aria-label="Semana siguiente">›</button>
    </nav>
    ${S.plansError ? `<div class="offline-banner">${esc(S.plansError)}</div>` : ui.error ? `<div class="offline-banner">${esc(ui.error)}</div>` : ''}
    ${offline ? '<div class="offline-banner">📴 Sin conexión: se ve el menú guardado en este dispositivo. Para cambiarlo hace falta conexión.</div>' : ''}
    ${ui.loading ? '<div class="empty-note">Cargando el menú…</div>' : ''}
    <div class="menu-week">${days.map((d) => `
      <article class="menu-day${d.iso === today ? ' today' : ''}" aria-label="${esc(`${d.name} ${dayLabel(d.date)}`)}">
        <h3><span>${esc(d.name)}</span><small>${esc(dayLabel(d.date))}${d.iso === today ? ' · hoy' : ''}</small></h3>
        ${['comida', 'cena'].map((slot) => {
          const list = menuFor(d.iso, slot);
          return `<section class="menu-slot ${slot}">
            <button type="button" class="ms-head" data-add="${d.iso}" data-slot="${slot}" aria-label="Añadir receta: ${SLOT_LABEL[slot]} del ${esc(d.name)}"><b>${slot === 'comida' ? '☀️' : '🌙'} ${SLOT_LABEL[slot]}</b><span aria-hidden="true">＋</span></button>
            ${list.length ? `<ul class="menu-entries">${list.map(entryHtml).join('')}</ul>` : ''}
          </section>`;
        }).join('')}
      </article>`).join('')}
    </div>`;
}

const bound = new WeakSet();
function bind(el) {
  if (bound.has(el)) return;
  bound.add(el);
  el.addEventListener('click', async (e) => {
    const wk = e.target.closest('[data-week]');
    if (wk) { ui.offset = Number(wk.dataset.week) === 0 ? 0 : ui.offset + Number(wk.dataset.week); paint(el); load(el); return; }
    const del = e.target.closest('[data-del]');
    if (del) {
      const entry = S.menu.get(del.dataset.del);
      const r = entry && S.recipes.get(entry.recipe_id);
      if (!(await confirmDialog('Quitar del menú', `¿Quitamos «${esc(r?.name || 'esta receta')}» de este día? La receta sigue guardada para otras veces.`, 'Quitar', 'danger', true))) return;
      try { await removeMenuEntry(del.dataset.del); broadcast('menu'); toast('Quitado del menú.'); }
      catch (err) { dialog({ title: 'No se ha quitado', message: explainError(err) }); }
      return;
    }
    const add = e.target.closest('[data-add]');
    if (add) openPicker(add.dataset.add, add.dataset.slot);
  });
}

/* =================================================================
   Elegir o crear una receta
   ================================================================= */
function openPicker(iso, slot) {
  const d = parseIso(iso);
  const title = `${SLOT_LABEL[slot]} · ${DAY_NAMES[(d.getDay() + 6) % 7]} ${dayLabel(d)}`;
  const state = { q: '' };
  const body = openPanel(title, `
    <form class="recipe-form" data-form autocomplete="off">
      <label class="field"><span>Busca una receta de ${slot === 'cena' ? 'cena' : 'comida'} o escribe una nueva</span>
        <span class="recipe-input-row">
          <input class="input" type="text" data-rq maxlength="120" placeholder="Por ejemplo: lentejas con chorizo" enterkeyhint="done" autocapitalize="sentences" spellcheck="true">
          <button type="submit" class="btn primary" data-addnew>Añadir</button>
        </span>
      </label>
    </form>
    <div data-rhint class="muted recipe-hint"></div>
    <h4 class="recipe-list-title">${slot === 'cena' ? '🌙 Recetas de cena anteriores' : '☀️ Recetas de comida anteriores'}</h4>
    <div class="recipe-grid" data-rlist></div>`);
  const input = body.querySelector('[data-rq]');
  const paintList = () => {
    // El panel puede haberse cambiado ya (receta nueva → elegir imagen): entonces no se pinta nada.
    if (!body.querySelector('[data-rlist]') || !body.querySelector('[data-rq]')) return;
    const words = norm(state.q).split(' ').filter(Boolean);
    const list = recipesFor(slot).filter((r) => !words.length || words.every((w) => r.name_key.includes(w) || norm(r.name).includes(w)))
      .sort((a, b) => collator.compare(a.name, b.name));
    body.querySelector('[data-rlist]').innerHTML = list.length
      ? list.map((r) => `<button type="button" class="recipe-card" data-rpick="${esc(r.id)}"><span class="rc-img"><img src="${esc(r.image_url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span><span class="rc-name">${esc(r.name)}</span></button>`).join('')
      : `<div class="empty-note">${words.length ? 'Ninguna receta anterior coincide. Pulsa «Añadir» para crearla.' : `Todavía no hay recetas de ${slot === 'cena' ? 'cena' : 'comida'}. Escribe la primera arriba.`}</div>`;
    const exact = [...S.recipes.values()].find((r) => r.name_key === recipeKey(state.q));
    body.querySelector('[data-rhint]').innerHTML = !state.q.trim() ? '' : exact
      ? `«${esc(exact.name)}» ya existe${exact[slot === 'cena' ? 'for_dinner' : 'for_lunch'] ? '' : ` como ${slot === 'cena' ? 'comida' : 'cena'}: se guardará también como ${slot === 'cena' ? 'cena' : 'comida'}`}. Se usará su imagen.`
      : 'Receta nueva: al pulsar «Añadir» o Intro buscaremos imágenes para elegir una.';
  };
  input.addEventListener('input', debounce(() => { state.q = input.value; paintList(); }, 150));
  body.querySelector('[data-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = input.value.replace(/\s+/g, ' ').trim();
    if (!name) { input.focus(); return; }
    const existing = [...S.recipes.values()].find((r) => r.name_key === recipeKey(name));
    if (existing) { await save({ date: iso, slot, recipeId: existing.id }, existing.name); return; }
    chooseImage(iso, slot, name);
  });
  // #panelBody es el mismo elemento para todos los paneles: se ASIGNA (no se acumulan escuchadores).
  body.onchange = null;
  body.onclick = async (e) => {
    const pick = e.target.closest('[data-rpick]');
    if (pick) { const r = S.recipes.get(pick.dataset.rpick); await save({ date: iso, slot, recipeId: pick.dataset.rpick }, r?.name); }
  };
  paintList();
  setTimeout(() => input.focus({ preventScroll: true }), 60);
}

async function save(args, name) {
  try {
    await addMenuEntry(args);
    broadcast('menu');
    closePanel();
    toast(`«${name || 'Receta'}» añadida al menú.`);
  } catch (err) { dialog({ title: 'No se ha añadido', message: explainError(err) }); }
}

/** Paso 2 de una receta nueva: elegir su imagen (obligatoria). */
function chooseImage(iso, slot, name) {
  const st = { images: [], shown: 0, page: 0, more: true, loading: false, error: '', selected: null, provider: '' };
  const body = openPanel(`Imagen para «${name}»`, `
    <p class="muted" style="margin-top:0">Elige una imagen: quedará guardada con la receta y se reutilizará siempre que la uséis.</p>
    <div data-istate></div>
    <div class="image-grid" data-igrid></div>
    <div class="row image-actions">
      <button type="button" class="btn small ghost" data-imore hidden>🔄 Cargar más imágenes</button>
      <label class="btn small ghost">📷 Subir una foto<input type="file" accept="image/*" data-iupload hidden></label>
      <button type="button" class="btn small ghost" data-iback>← Cambiar el nombre</button>
    </div>
    <div class="row end" style="margin-top:12px"><button type="button" class="btn primary" data-isave disabled>Guardar receta</button></div>`);
  const paint = () => {
    if (!body.querySelector('[data-istate]') || !body.querySelector('[data-igrid]')) return;   // panel ya cerrado o cambiado
    body.querySelector('[data-istate]').innerHTML = st.loading ? '<div class="empty-note"><span class="spinner" aria-hidden="true"></span> Buscando imágenes en webs de recetas…</div>'
      : st.error ? `<div class="offline-banner">${esc(st.error)}<br><small>Puedes reintentar o subir una foto propia.</small> <button type="button" class="btn small ghost" data-iretry>Reintentar</button></div>`
      : !st.images.length ? '<div class="empty-note">No se han encontrado imágenes. Prueba a cambiar el nombre o sube una foto.</div>' : '';
    const shown = st.images.slice(0, st.shown);
    body.querySelector('[data-igrid]').innerHTML = shown.map((im, i) => `<button type="button" class="image-choice${st.selected === im ? ' selected' : ''}" data-ipick="${i}" aria-pressed="${st.selected === im}" title="${esc(im.title || '')}"><img src="${esc(im.thumb || im.url)}" alt="${esc(im.title || `Imagen ${i + 1}`)}" loading="lazy" decoding="async" referrerpolicy="no-referrer"><small>${esc(im.source || '')}</small></button>`).join('');
    body.querySelector('[data-imore]').hidden = st.loading || (!st.more && st.shown >= st.images.length) || !st.images.length;
    body.querySelector('[data-isave]').disabled = !st.selected;
  };
  const fetchMore = async () => {
    if (st.loading) return;
    if (st.shown < st.images.length) { st.shown = Math.min(st.images.length, st.shown + 5); paint(); return; }
    if (!st.more) return;
    st.loading = true; st.error = ''; paint();
    try {
      const res = await searchRecipeImages(name, st.page);
      const seen = new Set(st.images.map((x) => x.url));
      st.images.push(...(res.images || []).filter((x) => x?.url && !seen.has(x.url)));
      st.more = !!res.more; st.page += 1; st.provider = res.provider;
      st.shown = Math.min(st.images.length, st.shown + 5);
    } catch (err) { st.error = `No se han podido buscar imágenes: ${explainError(err)}`; console.error('[Despensa] Imágenes de recetas:', err); }
    st.loading = false; paint();
  };
  body.onclick = async (e) => {
    const pick = e.target.closest('[data-ipick]');
    if (pick) { st.selected = st.images[Number(pick.dataset.ipick)]; paint(); return; }
    if (e.target.closest('[data-imore]')) { fetchMore(); return; }
    if (e.target.closest('[data-iretry]')) { st.more = true; fetchMore(); return; }
    if (e.target.closest('[data-iback]')) { closePanel(); setTimeout(() => openPicker(iso, slot), 50); return; }
    if (e.target.closest('[data-isave]')) {
      if (!st.selected) { toast('Elige una imagen: es obligatoria.'); return; }
      await save({ date: iso, slot, name, image: { url: st.selected.url, source: st.selected.source, page: st.selected.page, credit: st.selected.credit } }, name);
    }
  };
  body.querySelector('[data-iupload]').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    st.loading = true; st.error = ''; paint();
    try {
      const small = await shrinkImage(f);
      const up = await uploadRecipeImage(small);
      const im = { url: up.url, thumb: up.url, source: 'Foto subida', title: name };
      st.images.unshift(im); st.shown = Math.min(st.images.length, Math.max(5, st.shown + 1)); st.selected = im;
    } catch (err) { st.error = `No se ha podido subir la foto: ${explainError(err)}`; }
    st.loading = false; paint();
  });
  paint();
  fetchMore();
}

/** Reduce la foto antes de subirla (máximo 1200 px, JPEG). Funciona también en Safari/iPad. */
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type || 'image/')) { reject(new Error('El archivo no es una imagen.')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, 1200 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => (b ? resolve(new File([b], 'receta.jpg', { type: 'image/jpeg' })) : reject(new Error('No se ha podido preparar la foto.'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se ha podido leer la foto (formato no admitido).')); };
    img.src = url;
  });
}
