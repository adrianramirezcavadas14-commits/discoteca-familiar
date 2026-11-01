/* =====================================================================
   Semanas del menú (lunes a domingo, en la hora local del dispositivo).
   Se trabaja con fechas «AAAA-MM-DD» sin pasar por UTC: así un cambio de
   hora o la medianoche no desplazan el día.
   ===================================================================== */
export const DAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** «AAAA-MM-DD» → Date local a las 12:00 (lejos de la medianoche y de los cambios de hora). */
export function parseIso(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}
/** Lunes de la semana de una fecha (local). */
export function mondayOf(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
export function addDays(date, n) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}
/** Los 7 días (lunes…domingo) de la semana que empieza en `monday`. */
export function weekDays(monday) {
  return Array.from({ length: 7 }, (_, i) => { const d = addDays(monday, i); return { date: d, iso: isoDate(d), weekday: i + 1, name: DAY_NAMES[i] }; });
}
/** Número de semana ISO 8601 (la semana 1 es la que contiene el primer jueves del año). */
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { week: Math.ceil(((d - yearStart) / 86400000 + 1) / 7), year: d.getUTCFullYear() };
}
export const dayLabel = (d, withYear = false) => `${d.getDate()} de ${MONTH_NAMES[d.getMonth()]}${withYear ? ` de ${d.getFullYear()}` : ''}`;
/** «del 26 de octubre al 1 de noviembre de 2026» (con el año de cada extremo si cambia). */
export function weekRangeLabel(monday) {
  const sunday = addDays(monday, 6);
  const sameYear = monday.getFullYear() === sunday.getFullYear();
  return { monday: dayLabel(monday, !sameYear), sunday: dayLabel(sunday, true) };
}
/** Milisegundos hasta la próxima medianoche local (para cambiar de semana sola el lunes). */
export function msToMidnight(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5, 0);
  return Math.max(1000, next - now);
}
