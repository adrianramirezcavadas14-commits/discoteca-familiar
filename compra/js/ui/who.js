/* =====================================================================
   ¿Quién usa este dispositivo? (para la inicial de «quién lo apuntó»)
   Si el dispositivo aún no lo sabe, se pregunta ANTES de añadir el producto.
   ===================================================================== */
import { hogarUser } from '../data/store.js';

/**
 * La persona ya no se pregunta en la despensa: es el usuario de Hogar (se elige al entrar en Hogar).
 * Papá, Mamá y Adrián dejan su inicial; María e Invitado pueden añadir, sin inicial.
 * Devuelve true cuando ya se sabe quién usa Hogar.
 */
export async function ensureWho() {
  if (hogarUser()) return true;
  const ready = window.HogarUser?.ready?.();
  if (ready) await ready;
  return true;
}
