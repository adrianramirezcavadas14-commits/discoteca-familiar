/* =====================================================================
   Mapa conceptual del supermercado (sin imagen fija)
   ---------------------------------------------------------------------
   El plano es una cuadrícula CSS de 100 × 50 celdas. Cada zona guarda en
   Supabase (store_zones.map_shapes) uno o varios rectángulos:
     { x, y, w, h, r? }  · x, y desde 1 · r = giro en grados
   En móviles en vertical el plano se gira 90° (cuadrícula de 50 × 100)
   para que las zonas tengan un tamaño cómodo para el dedo.
   ===================================================================== */

export const GRID = { cols: 100, rows: 50 };

/* Pasillos y límites (barras grises del plano de referencia; no se pulsan). */
export const WALLS = [
  { x: 8, y: 14, w: 1, h: 23 }, { x: 17, y: 17, w: 1, h: 20 }, { x: 28, y: 14, w: 1, h: 23 },
  { x: 38, y: 17, w: 1, h: 20 }, { x: 48, y: 15, w: 1, h: 22 }, { x: 64, y: 15, w: 1, h: 22 },
  { x: 75, y: 11, w: 1, h: 26 }, { x: 85, y: 5, w: 1, h: 32 }
];
/* Zona de cajas (rayada en el plano de referencia). */
export const CHECKOUT = { x: 49, y: 44, w: 52, h: 6 };

/* Forma original de cada zona (la del plano de referencia), para «Volver a la forma original». */
export const DEFAULT_SHAPES = {
  z01: [{ x: 8, y: 38, w: 39, h: 5 }], z02: [{ x: 1, y: 14, w: 6, h: 29 }], z03: [{ x: 1, y: 1, w: 15, h: 12 }],
  z04: [{ x: 9, y: 14, w: 7, h: 23 }], z05: [{ x: 18, y: 22, w: 9, h: 15 }], z06: [{ x: 18, y: 1, w: 9, h: 16 }],
  z07: [{ x: 29, y: 1, w: 8, h: 12 }], z08: [{ x: 29, y: 17, w: 8, h: 20 }], z09: [{ x: 39, y: 17, w: 8, h: 20 }],
  z10: [{ x: 49, y: 15, w: 14, h: 22, lp: 'end' }], z11: [{ x: 65, y: 11, w: 9, h: 26 }], z12: [{ x: 76, y: 5, w: 8, h: 32 }],
  z13: [{ x: 86, y: 5, w: 14, h: 32 }], z14: [{ x: 50, y: 1, w: 50, h: 3 }],
  z15: [{ x: 38, y: 6, w: 21, h: 3, r: 20 }, { x: 55, y: 17, w: 3, h: 13 }, { x: 63, y: 10, w: 2, h: 4 }]
};

/** Gira un rectángulo 90° en sentido horario dentro de la cuadrícula. */
export function rotateRect(rect, grid = GRID) {
  return {
    x: grid.rows - (rect.y + rect.h - 1) + 1,
    y: rect.x,
    w: rect.h,
    h: rect.w,
    r: rect.r ? rect.r + 90 : 0
  };
}

/** Operación inversa de rotateRect (de la vista girada del móvil al plano real). */
export function unrotateRect(r, grid = GRID) {
  return { x: r.y, y: grid.rows - r.x - r.w + 2, w: r.h, h: r.w };
}

/**
 * Cambia el tamaño o la posición de una forma tal y como se VE en pantalla
 * (en el móvil el plano está girado) y la devuelve en coordenadas reales.
 * handle: 'e' | 'w' | 'n' | 's' | 'se' | 'move' · dc / dr = columnas / filas en pantalla.
 * Nunca sale del plano ni baja de 1 × 1 celdas. Conserva el giro (r) y la etiqueta (lp).
 */
export function resizeShape(shape, handle, dc, dr, rotated = false) {
  const g = gridFor(rotated);
  const s = rotated ? rotateRect(shape) : { ...shape };
  let { x, y, w, h } = s;
  const right = x + w - 1, bottom = y + h - 1;
  if (handle === 'move') {
    x = Math.min(Math.max(1, x + dc), g.cols - w + 1);
    y = Math.min(Math.max(1, y + dr), g.rows - h + 1);
  } else {
    if (handle.includes('e')) w = Math.min(Math.max(1, w + dc), g.cols - x + 1);
    if (handle.includes('s')) h = Math.min(Math.max(1, h + dr), g.rows - y + 1);
    if (handle.includes('w')) { x = Math.min(Math.max(1, x + dc), right); w = right - x + 1; }
    if (handle.includes('n')) { y = Math.min(Math.max(1, y + dr), bottom); h = bottom - y + 1; }
  }
  const real = rotated ? unrotateRect({ x, y, w, h }) : { x, y, w, h };
  const out = { ...shape, ...real };
  return out;
}

/** Agranda o reduce una forma por los dos lados a la vez (botones + / −), manteniéndola centrada. */
export function growShape(shape, axis, delta, rotated = false) {
  const g = gridFor(rotated);
  const s = rotated ? rotateRect(shape) : shape;
  if (axis === 'w') {
    if (delta > 0) return s.x + s.w - 1 < g.cols ? resizeShape(shape, 'e', delta, 0, rotated) : resizeShape(shape, 'w', -delta, 0, rotated);
    return resizeShape(shape, 'e', delta, 0, rotated);
  }
  if (delta > 0) return s.y + s.h - 1 < g.rows ? resizeShape(shape, 's', 0, delta, rotated) : resizeShape(shape, 'n', 0, -delta, rotated);
  return resizeShape(shape, 's', 0, delta, rotated);
}

export function gridFor(rotated) {
  return rotated ? { cols: GRID.rows, rows: GRID.cols } : GRID;
}

/** Estilo CSS de un rectángulo. */
export function rectStyle(rect, rotated = false) {
  const r = rotated ? rotateRect(rect) : rect;
  // Un arcón girado en vertical vuelve a quedar casi horizontal: se compensa para conservar su forma.
  const angle = rotated && rect.r ? rect.r : (rect.r || 0);
  return `grid-column:${r.x} / span ${r.w};grid-row:${r.y} / span ${r.h};${angle ? `--rot:${angle}deg;` : ''}`;
}

/** Rectángulo «principal» de una zona (el mayor), donde se pinta la etiqueta. */
export function mainShapeIndex(shapes = []) {
  let best = 0, area = -1;
  shapes.forEach((s, i) => { const a = s.w * s.h; if (a > area) { area = a; best = i; } });
  return best;
}

/** Orientación de una forma una vez colocada (para decidir si la etiqueta va en vertical). */
export function isTall(rect, rotated = false) {
  const r = rotated ? rotateRect(rect) : rect;
  return r.h > r.w * 1.6;
}


export function validShapes(shapes) {
  return Array.isArray(shapes) && shapes.length > 0 && shapes.every((s) => [s.x, s.y, s.w, s.h].every((v) => Number.isInteger(v) && v >= 1 && v <= 100));
}

/** Forma que se puede guardar: dentro del plano de 100 × 50. */
export function shapeFits(s) {
  return validShapes([s]) && s.x + s.w - 1 <= GRID.cols && s.y + s.h - 1 <= GRID.rows;
}

/** Solo los campos que se guardan en Supabase. */
export function cleanShape(s) {
  const o = { x: s.x, y: s.y, w: s.w, h: s.h };
  if (s.r) o.r = s.r;
  if (s.lp === 'end') o.lp = 'end';
  return o;
}
