// Solo para pruebas locales: ejecuta el index.ts REAL de una función Edge en el puerto indicado
// (Deno.serve usa el 8000 por defecto, que puede estar ocupado en el equipo de pruebas).
const port = Number(Deno.env.get('TEST_PORT') ?? '8601');
const fn = Deno.env.get('TEST_FUNCTION') ?? 'compra-sync';
const original = Deno.serve.bind(Deno);
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (handler: (req: Request) => Response | Promise<Response>) => original({ port, hostname: '127.0.0.1', onListen: () => console.error(`[${fn}] escuchando en ${port}`) }, handler);
await import(new URL(`../../supabase/functions/${fn}/index.ts`, import.meta.url).href);
