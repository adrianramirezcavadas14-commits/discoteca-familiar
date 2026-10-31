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
  { x: 75, y: 11, w: 1, h: 26 }, { x: 85, y: 5, w: 1, h: 32 }, { x: 18, y: 18, w: 9, h: 1 }
];
/* Zona de cajas (rayada en el plano de referencia). */
export const CHECKOUT = { x: 49, y: 44, w: 52, h: 6 };

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
