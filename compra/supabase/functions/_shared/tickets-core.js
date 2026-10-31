// =====================================================================
// HOGAR · DESPENSA · Validación de tickets (sin dependencias)
// =====================================================================

export const MAX_TICKET_BYTES = 10 * 1024 * 1024;   // 10 MB
export const TICKET_BUCKET = 'compra-tickets';

const TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf'
};

/** Detecta el tipo real por los primeros bytes (no se confía en la extensión ni en el tipo declarado). */
export function sniffMime(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const ascii = (from, to) => String.fromCharCode(...b.slice(from, to));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a) return 'image/png';
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 5 && ascii(0, 5) === '%PDF-') return 'application/pdf';
  if (b.length >= 12 && ascii(4, 8) === 'ftyp' && /^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(ascii(8, 12))) return 'image/heic';
  return null;
}

export function extensionFor(mime) {
  return TYPES[mime] || null;
}

/** Valida tamaño y formato. Devuelve { ok, mime, ext, error }. */
export function validateTicketFile(bytes, declaredType = '') {
  const size = bytes?.byteLength ?? bytes?.length ?? 0;
  if (!size) return { ok: false, error: 'El archivo está vacío.' };
  if (size > MAX_TICKET_BYTES) return { ok: false, error: 'El archivo supera los 10 MB.' };
  const mime = sniffMime(bytes instanceof Uint8Array ? bytes.subarray(0, 32) : new Uint8Array(bytes).subarray(0, 32));
  if (!mime) return { ok: false, error: 'Formato no admitido. Usa una foto (JPG, PNG, WEBP, HEIC) o un PDF.' };
  const declared = String(declaredType || '').toLowerCase();
  if (declared && declared !== 'application/octet-stream' && !(declared === mime || (mime === 'image/heic' && declared === 'image/heif'))) {
    return { ok: false, error: 'El tipo del archivo no coincide con su contenido.' };
  }
  return { ok: true, mime, ext: extensionFor(mime), size };
}

/** Ruta única dentro del bucket privado: <familia>/<año>/<uuid>.<ext> */
export function ticketPath(householdId, uuid, ext, date = new Date()) {
  if (!/^[0-9a-f-]{36}$/i.test(householdId) || !/^[0-9a-f-]{36}$/i.test(uuid) || !/^(jpg|png|webp|heic|pdf)$/.test(ext)) {
    throw new Error('Ruta de ticket no válida');
  }
  return `${householdId.toLowerCase()}/${date.getUTCFullYear()}/${uuid.toLowerCase()}.${ext}`;
}

export function parseAmount(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/\s|€/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n >= 100000) return NaN;
  return Math.round(n * 100) / 100;
}

export function parseDate(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? NaN : s;
}
