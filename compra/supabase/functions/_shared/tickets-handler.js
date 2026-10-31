// =====================================================================
// HOGAR · DESPENSA · Lógica HTTP de «compra-tickets» (independiente de Deno)
// storage: { upload(path, bytes, mime), remove(path), signedUrl(path, segundos) }
// =====================================================================
import { createSupabaseDb } from './db-supabase.js';
import { corsHeaders, json, resolveCaller, cleanText } from './http.js';
import { validateTicketFile, ticketPath, parseAmount, parseDate, MAX_TICKET_BYTES } from './tickets-core.js';

const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Almacenamiento real: bucket privado de Supabase Storage. */
export function supabaseStorage(client, bucket) {
  return {
    async upload(path, bytes, mime) { const { error } = await client.storage.from(bucket).upload(path, bytes, { contentType: mime, upsert: false, cacheControl: '0' }); if (error) throw error; },
    async remove(path) { await client.storage.from(bucket).remove([path]); },
    async signedUrl(path, seconds) { const { data, error } = await client.storage.from(bucket).createSignedUrl(path, seconds); if (error) throw error; return data.signedUrl; }
  };
}

export function createTicketsHandler({ client, storage, allowedOrigins = '', newId = () => crypto.randomUUID() }) {
  const db = createSupabaseDb(client);
  async function profileId(householdId, code) {
    const c = cleanText(code, 20);
    if (!c) return null;
    const { data } = await client.from('family_profiles').select('id').eq('household_id', householdId).eq('code', c.toLowerCase()).eq('active', true).maybeSingle();
    return data?.id ?? null;
  }

  return async function handle(req) {
    const cors = corsHeaders(req, allowedOrigins);
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors);
    try {
      const caller = await resolveCaller(req, db);
      if (!caller) return json({ error: 'Clave familiar no válida.', code: 'clave_familiar_no_valida' }, 401, cors);
      const h = caller.householdId;
      const type = req.headers.get('content-type') || '';

      if (type.includes('application/json')) {
        const body = await req.json().catch(() => ({}));
        if (body.action !== 'signed-url' || !isUuid(body.receipt_id)) return json({ error: 'Petición no válida' }, 400, cors);
        const { data: rc } = await client.from('purchase_receipts').select('storage_path,mime_type')
          .eq('id', body.receipt_id).eq('household_id', h).is('deleted_at', null).maybeSingle();
        if (!rc) return json({ error: 'No se encuentra el ticket.' }, 404, cors);
        return json({ url: await storage.signedUrl(rc.storage_path, 300), mime: rc.mime_type, expiresIn: 300 }, 200, cors);
      }

      if (!type.includes('multipart/form-data')) return json({ error: 'Formato de petición no válido' }, 400, cors);
      const len = Number(req.headers.get('content-length') || 0);
      if (len > MAX_TICKET_BYTES + 200000) return json({ error: 'El archivo supera los 10 MB.' }, 413, cors);
      const form = await req.formData();
      if (form.get('action') !== 'upload') return json({ error: 'Acción desconocida' }, 400, cors);
      const file = form.get('file');
      if (!file || typeof file.arrayBuffer !== 'function') return json({ error: 'Falta el archivo.' }, 400, cors);
      if (file.size > MAX_TICKET_BYTES) return json({ error: 'El archivo supera los 10 MB.' }, 413, cors);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const check = validateTicketFile(bytes, file.type);
      if (!check.ok) return json({ error: check.error }, 415, cors);

      const amount = parseAmount(form.get('amount'));
      if (Number.isNaN(amount)) return json({ error: 'Importe no válido.' }, 400, cors);
      const receiptDate = parseDate(form.get('receipt_date'));
      if (Number.isNaN(receiptDate)) return json({ error: 'Fecha no válida.' }, 400, cors);
      const sessionId = form.get('session_id');
      if (sessionId) {
        if (!isUuid(sessionId)) return json({ error: 'Compra no válida.' }, 400, cors);
        const { data: s } = await client.from('shopping_sessions').select('id').eq('id', sessionId).eq('household_id', h).eq('status', 'completed').maybeSingle();
        if (!s) return json({ error: 'El ticket solo se puede asociar a una compra finalizada.' }, 400, cors);
      }
      const paidBy = await profileId(h, form.get('paid_by'));
      const actor = await profileId(h, form.get('actor'));
      const id = newId();
      const path = ticketPath(h, newId(), check.ext);
      await storage.upload(path, bytes, check.mime);
      const { data: row, error } = await client.from('purchase_receipts').insert({
        id, household_id: h, session_id: sessionId || null, storage_path: path,
        file_name: cleanText(file.name, 160), mime_type: check.mime, size_bytes: check.size, paid_by: paidBy,
        amount, receipt_date: receiptDate, notes: cleanText(form.get('notes'), 500), uploaded_by: actor
      }).select().single();
      if (error) { await storage.remove(path); throw error; }   // no dejar archivos huérfanos
      await client.from('audit_log').insert({ household_id: h, actor_id: actor, action: 'upload_receipt', entity: 'purchase_receipts', entity_id: id, details: { size: check.size, mime: check.mime } });
      return json({ receipt: row }, 200, cors);
    } catch (e) {
      console.error(e);
      return json({ error: 'No se pudo completar la operación con el ticket.', detail: String(e?.message || e) }, 500, cors);
    }
  };
}
