/* =====================================================================
   Cola local de operaciones (sin conexión) · lógica pura
   ---------------------------------------------------------------------
   Cada operación lleva un identificador idempotente (op_id): si se envía
   dos veces, Supabase devuelve el mismo resultado sin repetirla.
   Reglas de fusión:
   · Borrador de la lista: por producto gana el último cambio.
   · Resultados de la compra: un estado final nunca vuelve a «pendiente»;
     entre dos finales gana el más reciente (resolved_at).
   ===================================================================== */

export const FINAL = new Set(['collected', 'partial', 'out_of_stock']);

/** ¿Debe el resultado entrante sustituir al actual? */
export function shouldReplaceResult(current, incoming) {
  if (!incoming) return false;
  if (!current) return true;
  if (incoming.status === 'pending') return false;   // nunca se vuelve a pendiente
  if (current.status === 'pending') return true;
  const a = new Date(current.resolved_at || 0).getTime();
  const b = new Date(incoming.resolved_at || 0).getTime();
  return b >= a;
}

/** Fusiona resultados del servidor con los locales (los locales sin enviar tienen prioridad si son finales y más recientes). */
export function mergeResults(serverResults, localResults) {
  const map = new Map(serverResults.map((r) => [r.list_item_id, { ...r }]));
  for (const l of localResults) {
    const cur = map.get(l.list_item_id);
    if (shouldReplaceResult(cur, l)) map.set(l.list_item_id, { ...(cur || {}), ...l });
  }
  return [...map.values()];
}

/** Normaliza un resultado (igual que el servidor). */
export function normalizeResult(r, requested) {
  let status = r.status, q = Number(r.collected_qty) || 0;
  if (status === 'collected') q = requested;
  else if (status === 'out_of_stock' || status === 'pending') q = 0;
  else if (status === 'partial') {
    if (q >= requested) { status = 'collected'; q = requested; } else if (q <= 0) { status = 'out_of_stock'; q = 0; }
  }
  return { ...r, status, collected_qty: q };
}

/**
 * Añade una operación a la cola, fusionando con la última pendiente del mismo tipo y destino.
 * queue: [{ id, kind, target, payload, createdAt, tries }]
 */
export function enqueue(queue, op) {
  const q = [...queue];
  // Solo se fusiona con una operación que todavía no se ha intentado enviar (si no, su op_id ya
  // podría estar aplicado en el servidor y los cambios nuevos se perderían).
  const last = [...q].reverse().find((o) => o.kind === op.kind && o.target === op.target && !o.sending && !o.tries && !o.failed);
  if (last && op.kind === 'draft') {
    const byProduct = new Map(last.payload.changes.map((c) => [c.product_id, c]));
    for (const c of op.payload.changes) byProduct.set(c.product_id, c);
    last.payload = { ...last.payload, changes: [...byProduct.values()] };
    return q;
  }
  if (last && op.kind === 'results') {
    const byItem = new Map(last.payload.results.map((r) => [r.list_item_id, r]));
    for (const r of op.payload.results) if (shouldReplaceResult(byItem.get(r.list_item_id), r)) byItem.set(r.list_item_id, r);
    last.payload = { ...last.payload, results: [...byItem.values()] };
    return q;
  }
  q.push({ ...op, createdAt: op.createdAt || new Date().toISOString(), tries: 0 });
  return q;
}

/** Errores que no se arreglan reintentando (datos rechazados por el servidor). */
export function isPermanentError(e) {
  const code = String(e?.code || '');
  const msg = String(e?.message || '');
  if (code === 'P0001' || code === '23514' || code === '22P02' || code === '23503') return true;
  return /lista_no_editable|compra_ya_iniciada|cantidad_no_valida|producto_oculto|producto_no_existe|compra_no_activa|lista_no_preparada/.test(msg);
}

/** Orden de envío: primero lo más antiguo; las operaciones dependientes nunca se adelantan. */
export function nextOp(queue) {
  return queue.find((o) => !o.failed) || null;
}

export function describeOp(op) {
  switch (op.kind) {
    case 'draft': return `Cambios en la lista (${op.payload.changes.length} productos)`;
    case 'results': return `Productos recogidos (${op.payload.results.length})`;
    case 'start': return 'Inicio de la compra';
    case 'finish': return 'Fin de la compra';
    default: return op.kind;
  }
}
