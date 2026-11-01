// Pruebas de la versión 1.2: media acumulada, semanas del menú, nombres de recetas y buscador universal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cumulativeAverageSeries, fmtMinutes } from '../../js/core/stats.js';
import { mondayOf, isoDate, isoWeek, weekDays, addDays, weekRangeLabel, parseIso, msToMidnight } from '../../js/core/week.js';
import { recipeKey } from '../../js/core/text.js';

const ses = (id, person, endedAt, seconds) => ({ id, shopper_profile_id: person, status: 'completed', ended_at: endedAt, duration_seconds: seconds });

test('media acumulada: ejemplo obligatorio 45,3 → 37,65 → 38,43', () => {
  const { points, total } = cumulativeAverageSeries([
    ses('b', 'papa', '2026-10-08T10:00:00Z', 30 * 60),
    ses('a', 'papa', '2026-10-01T10:00:00Z', 45.3 * 60),
    ses('c', 'papa', '2026-10-15T10:00:00Z', 40 * 60)
  ]);
  assert.equal(total, 3);
  assert.deepEqual(points.map((p) => Math.round(p.avg * 100) / 100), [45.3, 37.65, 38.43]);
  assert.deepEqual(points.map((p) => p.x), [1, 2, 3], 'ordenadas por fecha real');
  assert.equal(fmtMinutes(points[1].avg), '37,65 min');
  assert.equal(fmtMinutes(points[2].avg), '38,43 min');
});

test('media acumulada: una línea por persona, mismo eje X y sin mezclar tiempos', () => {
  const { points, byPerson } = cumulativeAverageSeries([
    ses('1', 'papa', '2026-01-01T10:00:00Z', 3600),
    ses('2', 'mama', '2026-01-02T10:00:00Z', 1200),
    ses('3', 'papa', '2026-01-03T10:00:00Z', 1800),
    ses('4', 'mama', '2026-01-04T10:00:00Z', null),           // sin duración: se ignora
    ses('5', 'mama', '2026-01-05T10:00:00Z', -5),             // inválida
    ses('6', 'mama', 'no es fecha', 600),                     // sin fecha válida
    ses('7', 'mama', '2026-01-06T10:00:00Z', 2400)
  ]);
  assert.deepEqual(points.map((p) => [p.x, p.personId]), [[1, 'papa'], [2, 'mama'], [3, 'papa'], [4, 'mama']]);
  assert.deepEqual(byPerson.get('papa').map((p) => p.avg), [60, 45], 'Papá: (60 + 30) / 2');
  assert.deepEqual(byPerson.get('mama').map((p) => p.avg), [20, 30], 'Mamá: (20 + 40) / 2, sin los tiempos de Papá');
});

test('semanas: lunes a domingo, cambios de mes y de año, semana ISO', () => {
  assert.equal(isoDate(mondayOf(new Date(2026, 10, 1, 9))), '2026-10-26', 'domingo 1/11 → lunes 26/10');
  assert.equal(isoDate(mondayOf(new Date(2026, 10, 2, 0, 5))), '2026-11-02', 'el lunes a las 00:05 ya es semana nueva');
  assert.equal(isoDate(mondayOf(new Date(2027, 0, 3, 23, 59))), '2026-12-28', 'domingo 3/1/2027 → lunes 28/12/2026');
  assert.deepEqual(isoWeek(new Date(2026, 11, 31)), { week: 53, year: 2026 });
  assert.deepEqual(isoWeek(new Date(2027, 0, 1)), { week: 53, year: 2026 });
  assert.deepEqual(isoWeek(new Date(2027, 0, 4)), { week: 1, year: 2027 });
  assert.deepEqual(isoWeek(new Date(2026, 10, 2)), { week: 45, year: 2026 });
  const days = weekDays(mondayOf(new Date(2026, 1, 25)));
  assert.deepEqual(days.map((d) => d.iso), ['2026-02-23', '2026-02-24', '2026-02-25', '2026-02-26', '2026-02-27', '2026-02-28', '2026-03-01']);
  assert.deepEqual(days.map((d) => d.weekday), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(isoDate(addDays(parseIso('2026-03-29'), 1)), '2026-03-30', 'cambio de hora de marzo');
  assert.equal(isoDate(addDays(parseIso('2026-10-25'), 1)), '2026-10-26', 'cambio de hora de octubre');
  assert.deepEqual(weekRangeLabel(mondayOf(new Date(2026, 11, 30))), { monday: '28 de diciembre de 2026', sunday: '3 de enero de 2027' });
  assert.ok(msToMidnight(new Date(2026, 10, 1, 23, 59, 0)) <= 70000);
});

test('recetas: mismo nombre normalizado que la base de datos (sin duplicados por tildes o espacios)', () => {
  assert.equal(recipeKey('  Lentejas   con CHORIZO!! '), 'lentejas con chorizo');
  assert.equal(recipeKey('Crema de calabacín'), recipeKey('crema de CALABACIN'));
  assert.equal(recipeKey('Ñoquis al pesto'), 'ñoquis al pesto');
  assert.notEqual(recipeKey('Año nuevo'), recipeKey('Ano nuevo'), 'la ñ no se confunde con la n');
});

test('buscador universal: sin tildes ni mayúsculas, parcial y en todas las zonas', async () => {
  const { findProducts } = await import('../../js/core/catalog-view.js');
  const selectable = (p) => p.visible_in_app && p.active !== false && p.availability !== 'removed';
  const mk = (id, name, extra = {}) => ({ id, name, visible_in_app: true, active: true, availability: 'available', _hay: name.toLowerCase(), ...extra });
  const list = [mk('1', 'Agua mineral Aguadoy'), mk('2', 'Plátano de Canarias'), mk('3', 'Batido de plátano'), mk('4', 'Plátano oculto', { visible_in_app: false }), mk('5', 'Pan de molde')];
  assert.deepEqual(findProducts('PLATANO', list, selectable).map((p) => p.id), ['2', '3'], 'primero los que empiezan así; los ocultos no salen');
  assert.deepEqual(findProducts('guado', list, selectable).map((p) => p.id), ['1']);
  assert.deepEqual(findProducts('', list, selectable), []);
});
