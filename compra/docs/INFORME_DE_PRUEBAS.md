# Informe de pruebas · 30/10/2026

Entorno: Linux, Node 22.23, PostgreSQL 16.15, PostgREST 12.2.3 (el motor de la API REST de Supabase), Chromium (Playwright) y Deno 2.1.4 para las funciones Edge.

**Resultado: todas las pruebas correctas.**

| Suite | Comando (desde `compra/`) | Resultado |
|---|---|---|
| Revisión estática | `npm run lint` | ✅ 46 módulos: sintaxis, importaciones, ids HTML, secretos, precarga del service worker |
| Lógica de la app y del servidor | `npm test` | ✅ 21/21 |
| Base de datos (migraciones, RLS, funciones) | `npm run test:sql` | ✅ 18/18 (incluido el modo sin clave) |
| Extremo a extremo con navegador real | `npm run test:e2e` | ✅ 14/14 pasos, 0 errores de consola |
| Funciones Edge reales con Deno | `deno check` + `npm run test:deno` | ✅ tipos correctos · 4/4 comprobaciones |

## Qué NO se ha probado aquí (y por qué)

* **Tu proyecto de Supabase**: las migraciones se han aplicado (dos veces, para comprobar que son repetibles) en un PostgreSQL 16 local con los mismos roles que Supabase (`anon`, `authenticated`, `service_role`, `authenticator`). **No se han ejecutado en tu proyecto**: hay que seguir `INSTALACION.md`.
* **La API de Mercadona y la copia de datania**: este entorno no tiene salida a esos dominios. Lo que sí está comprobado: (1) la estructura real de `categories.json`, `categories/<id>.json` y `products/<id>.json` (leída de los archivos publicados) y las pruebas usan datos de prueba con esa misma estructura; (2) la función Edge real, ejecutada con Deno, falla de forma controlada sin acceso a las fuentes y no toca el catálogo.
* **Storage de Supabase**: en las pruebas de extremo a extremo se sustituye por un almacenamiento en disco con URL firmadas que caducan; el código de validación y de la función es el mismo.
* **Realtime**: el entorno local no tiene servidor Realtime; la app lo tolera sin errores (los avisos entre dispositivos solo aceleran la actualización; al volver a la app se recarga igualmente).

## Cobertura de las pruebas pedidas

| Prueba pedida | Dónde |
|---|---|
| Asignación automática de zonas | unit 1 · SQL 2 |
| Prioridad de excepciones | unit 1 · SQL 2 |
| Productos nuevos | SQL 1, 3 · e2e «Novedades» |
| Productos retirados (3 ausencias, reaparecen) | SQL 3, 4 · e2e «Novedades» |
| Cambios de fotografía (sin preguntar, historial, zona conservada) | SQL 3 |
| Cambios de precio (historial, € y %) | SQL 3 · unit 4 |
| Cálculo de promociones (declarada ≠ bajada detectada) | unit 4, 16 · SQL 3 |
| Frecuencia por listas distintas (`COUNT(DISTINCT)`) | unit 6 · SQL 13 |
| Precio estimado | unit 5 · SQL 11 |
| Unidades parciales | unit 5, 14 · SQL 12 · e2e «Hacer la compra» |
| Productos sin existencias | unit 5 · SQL 12 · e2e |
| Navegación circular | unit 3 · e2e «Preparar la lista» |
| Persistencia al recargar | unit 12 · e2e «Persistencia» |
| Cola sin conexión | unit 9, 13 · e2e «Sin conexión» |
| Sincronización idempotente | SQL 11 (op_id repetido), 12, 8 (cerrojo) |
| Cálculo de tiempos | unit 8 · SQL 12 |
| Desviación respecto a la media (sin incluir la actual) | unit 8 · SQL 13 |
| Una lista abierta | SQL 11 (índice único y RPC) |
| Una lista cerrada pendiente | SQL 11 |
| Seguridad RLS | SQL 9, 10 (con clave activada: sin clave o clave errónea no ve nada; escrituras directas y funciones de administración denegadas) · modo abierto: sin clave funciona, pero las escrituras directas siguen prohibidas |

### Lógica (21)

1. Asignación de zona: excepción > subcategoría exacta > categoría > automática > sin clasificar
2. Solo se pregunta la zona cuando no se puede deducir, es ambigua o se pidió confirmación
3. Navegación circular entre zonas (y salto de zonas desactivadas)
4. Precio normal / promoción declarada / bajada detectada
5. Precio estimado de la lista y precio final de la compra
6. Frecuencia por listas distintas y bloques sin repetir
7. Búsqueda (sin acentos), filtros y orden
8. Desviación frente a la media ANTERIOR
9. Cola: los estados finales mandan y se fusionan cambios
10. Mapa: giro de 90° para móvil y formas válidas
11. Formatos de euros, tiempo y texto
12. El borrador se guarda en el dispositivo (IndexedDB + copia síncrona) y sobrevive a recargar
13. Sin conexión las operaciones esperan agrupadas y con identificador estable
14. Un resultado final no vuelve a pendiente
15. Árbol de categorías y productos con la estructura real de la API
16. Normalización defensiva de los datos de la fuente
17. Reintentos con espera exponencial, Retry-After y sin insistir ante bloqueos 4xx
18. URLs de los dos proveedores (API con almacén y datania)
19. Sincronización caducada a partir de 12 horas (nunca menos)
20. Tickets: tipo real por contenido, tamaño, ruta única e importes
21. CORS con la cabecera de la clave familiar

### Base de datos (16)

1. Primera sincronización = catálogo base (sin avisos de nuevos; Bebé guardado pero oculto)
2. Zona por prioridad (Bollería envasada → zona 4 aunque Panadería → zona 3)
3. Segunda sincronización: nuevo, promoción, bajada (−1,30 €, −7,54 %), subida, nombre, formato, foto, no disponible, posiblemente retirado; zona manual conservada
4. Retirado tras tres sincronizaciones; reaparece; fin de promoción
5. Una categoría que falla en las dos fuentes → se conserva el catálogo anterior
6. Si la API falla se usa datania
7. Una descarga sospechosamente pequeña no sustituye el catálogo
8. Una sola sincronización a la vez; la que pierde el latido se retoma; el cerrojo no se filtra
9. Sin clave o con clave errónea no se ve nada
10. Con la clave se lee, pero no se escribe directamente ni se llaman funciones de administración
11. Lista: precio del servidor, op_id idempotente, una abierta y una cerrada pendiente
12. Compra: un solo inicio, estados finales que no vuelven atrás, parcial, sin existencias, finalización idempotente
13. Desviación +50 % frente a la media anterior; frecuencia 2 listas aunque se pidieron 3 unidades
14. Zonas: mover, deshacer y quién lo hizo
15. Ajustes validados; ocultar categorías recalcula la visibilidad
16. Tickets: pagado con quién y cuándo; borrado lógico

### Extremo a extremo (14 pasos, Chromium)

1. Inicio de Hogar con tres tarjetas en tres columnas → entrar en la despensa
2. Entrada sin clave (modo abierto), sincronización inicial con el coyote, «¿Quién usa este dispositivo?»
3. Mapa: 15 zonas, congelados en tres piezas, cajas, vista en lista
4. Editor de zona: fotos sin texto con nombre accesible y carga diferida, 3 por fila; mover dos productos, registrar quién, deshacer
5. Preparar la lista: tres bloques, dos tarjetas por fila, cantidades sin escribir en Supabase con cada pulsación, flecha circular 1 → 15, guardar
6. Recargar sin guardar: no se pierde nada y se envía al volver
7. Cerrar la lista con el GIF del carro → «¡A por la compra!»
8. Compra en móvil (390 px): Papá, temporizador, dos por fila, ampliar foto, sin existencias, parcial, «Ya está todo. Puedes ir a caja.», finalizar con los osos, resumen con «Todavía no hay datos suficientes»
9. Ticket: subir imagen, asociar a la compra, rechazo en el servidor de un archivo falso, marcar pagado
10. El rincón de los números con las tres personas y gráficas
11. Nueva sincronización (≥ 12 h): «Hemos encontrado 2 productos nuevos»; el de categoría sin zona pide zona y el otro la hereda; promoción y bajada registradas
12. Sin conexión: recargar, añadir, guardar en el dispositivo; al volver la red se envía
13. 320 px y 768 px: sin desplazamiento horizontal y sin botones menores de 44 × 44 px
14. La discoteca y la biblioteca siguen abriendo sin errores

Las capturas se generan en `compra/tests/e2e/artifacts/` al ejecutar `npm run test:e2e`. Una selección (con los datos de prueba) está en `compra/docs/capturas/`.

## Cómo repetir las pruebas

```bash
cd compra
npm install
npm run lint && npm test
# Base de datos y extremo a extremo: necesitan PostgreSQL 16 en local y PostgREST
#   COMPRA_TEST_PG_HOST, COMPRA_TEST_PG_PORT, COMPRA_TEST_PG_USER (por defecto /tmp, 54329, postgres)
#   POSTGREST_BIN (ruta del binario de PostgREST)
npm run test:sql
npm run test:e2e
DENO=/ruta/a/deno npm run test:deno
```
