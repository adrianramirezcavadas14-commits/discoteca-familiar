/* =====================================================================
   El rincón de los números: tiempos, desviaciones y series para gráficas.
   Mensajes neutrales: nunca se compara a las personas de forma negativa.
   ===================================================================== */

/** ((tiempo_actual − media_anterior) / media_anterior) × 100 · null si no hay media anterior suficiente. */
export function deviationPct(current, previousAvg) {
  const c = Number(current), a = Number(previousAvg);
  if (!Number.isFinite(c) || !Number.isFinite(a) || a <= 0) return null;
  return Math.round(((c - a) / a) * 10000) / 100;
}

/**
 * Calcula la desviación de una compra respecto a la media de las ANTERIORES de la misma persona
 * (la compra actual no entra en la media) y devuelve la media actualizada.
 */
export function compareWithHistory(currentSeconds, previousDurations, minPrevious = 1) {
  const prev = previousDurations.filter((d) => Number.isFinite(Number(d)));
  const avg = prev.length >= minPrevious ? prev.reduce((s, d) => s + Number(d), 0) / prev.length : null;
  const deviation = avg == null ? null : deviationPct(currentSeconds, avg);
  const all = [...prev, Number(currentSeconds)];
  return { previousAvg: avg, deviation, newAvg: all.reduce((s, d) => s + d, 0) / all.length, enoughData: avg != null };
}

export const durationSeconds = (startedAt, endedAt) => Math.max(0, Math.round((new Date(endedAt) - new Date(startedAt)) / 1000));

/** Resumen por persona a partir de las compras completadas. */
export function shopperSummary(sessions, shopperId) {
  const mine = sessions.filter((s) => s.shopper_profile_id === shopperId && s.status === 'completed' && s.duration_seconds != null)
    .sort((a, b) => new Date(b.ended_at) - new Date(a.ended_at));
  if (!mine.length) return { total: 0 };
  const d = mine.map((s) => Number(s.duration_seconds));
  return {
    total: mine.length,
    avg: d.reduce((a, b) => a + b, 0) / d.length,
    last: d[0],
    lastThree: d.slice(0, 3),
    best: Math.min(...d),
    lastDeviation: mine[0].deviation_pct != null ? Number(mine[0].deviation_pct) : null,
    lastAt: mine[0].ended_at
  };
}

export function applyFilters(sessions, { year = null, month = null, person = null, from = null, to = null } = {}) {
  const f = from ? new Date(`${from}T00:00:00`) : null;
  const t = to ? new Date(`${to}T23:59:59`) : null;
  return sessions.filter((s) => {
    if (s.status !== 'completed' || !s.ended_at) return false;
    const d = new Date(s.ended_at);
    if (year != null && d.getFullYear() !== Number(year)) return false;
    if (month != null && d.getMonth() !== Number(month)) return false;
    if (person && s.shopper_profile_id !== person) return false;
    if (f && d < f) return false;
    if (t && d > t) return false;
    return true;
  });
}

/** { año: { personaId: n } } */
export function purchasesByYear(sessions) {
  const out = {};
  for (const s of sessions) {
    const y = new Date(s.ended_at).getFullYear();
    (out[y] ||= {})[s.shopper_profile_id] = ((out[y] || {})[s.shopper_profile_id] || 0) + 1;
  }
  return out;
}

/** 12 meses × personas: [{ month, byPerson: {id: n} }] */
export function purchasesByMonth(sessions) {
  const rows = Array.from({ length: 12 }, (_, m) => ({ month: m, byPerson: {} }));
  for (const s of sessions) {
    const m = new Date(s.ended_at).getMonth();
    rows[m].byPerson[s.shopper_profile_id] = (rows[m].byPerson[s.shopper_profile_id] || 0) + 1;
  }
  return rows;
}

/** Evolución del tiempo medio acumulado por mes: [{ key:'2026-03', avg }] por persona */
export function averageEvolution(sessions, personId) {
  const mine = sessions.filter((s) => s.shopper_profile_id === personId && s.duration_seconds != null)
    .sort((a, b) => new Date(a.ended_at) - new Date(b.ended_at));
  const out = [];
  let sum = 0, n = 0;
  for (const s of mine) {
    sum += Number(s.duration_seconds); n++;
    const d = new Date(s.ended_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const last = out[out.length - 1];
    if (last && last.key === key) last.avg = sum / n; else out.push({ key, avg: sum / n });
  }
  return out;
}

/** Productos que más veces no se encontraron: [{ product_id, times }] */
export function topMissing(results, limit = 10) {
  const m = new Map();
  for (const r of results) if (r.status === 'out_of_stock') m.set(r.product_id, (m.get(r.product_id) || 0) + 1);
  return [...m].map(([product_id, times]) => ({ product_id, times })).sort((a, b) => b.times - a.times).slice(0, limit);
}

/** Texto neutral de la desviación. */
export function deviationText(pct) {
  if (pct == null) return 'Todavía no hay datos suficientes';
  if (Math.abs(pct) < 1) return 'En su tiempo habitual';
  return pct < 0 ? `${Math.abs(pct).toLocaleString('es-ES', { maximumFractionDigits: 1 })} % menos que su media` : `${pct.toLocaleString('es-ES', { maximumFractionDigits: 1 })} % más que su media`;
}
