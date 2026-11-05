/* =====================================================================
   ¿Quién usa este dispositivo? (para la inicial de «quién lo apuntó»)
   Si el dispositivo aún no lo sabe, se pregunta ANTES de añadir el producto.
   ===================================================================== */
import { S, setMe } from '../data/store.js';
import { SHOPPERS } from '../config.js';
import { dialog, toast } from './dom.js';

let asking = null;

/** Devuelve el código de la persona (papa, mama, adrian) o null si se cancela. */
export async function ensureWho(action = 'añadirlo') {
  if (S.me) return S.me;
  if (asking) return asking;           // dos toques seguidos: una sola pregunta
  asking = (async () => {
    const r = await dialog({
      title: '¿Quién usa este dispositivo?',
      message: `Antes de ${action}: al lado de cada producto se verá la inicial de quien lo apuntó. Solo se pregunta una vez y se puede cambiar en Ajustes.`,
      buttons: [...SHOPPERS.map((s) => ({ label: s.name, value: s.code, kind: 'primary' })), { label: 'Cancelar', value: null }]
    });
    if (!r.value) { toast('No se ha añadido: primero elige quién eres.'); return null; }
    setMe(r.value);
    toast(`Hola, ${SHOPPERS.find((s) => s.code === r.value)?.name || ''}`);
    return S.me;
  })();
  try { return await asking; } finally { asking = null; }
}
