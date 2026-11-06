// =====================================================================
// HOGAR · DISCOTECA · spotify-buscar
// Busca en Spotify el primer álbum con ese nombre de ese artista y su primera canción.
// · Usa el flujo «client credentials» de la API de Spotify: el ID y el secreto viven solo
//   aquí, como secretos de Supabase (SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET). Nunca en la web.
// · Solo busca datos públicos del catálogo; no toca cuentas de nadie.
// · Autocontenida (sin imports) para poder desplegarla con --use-api.
// =====================================================================
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

let token: { value: string; exp: number } | null = null;
async function getToken(): Promise<string> {
  if (token && token.exp > Date.now() + 30_000) return token.value;
  const id = Deno.env.get('SPOTIFY_CLIENT_ID') || '';
  const secret = Deno.env.get('SPOTIFY_CLIENT_SECRET') || '';
  if (!id || !secret) throw Object.assign(new Error('Faltan los secretos SPOTIFY_CLIENT_ID y SPOTIFY_CLIENT_SECRET en Supabase.'), { code: 'sin_configurar' });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${id}:${secret}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  if (!res.ok) throw Object.assign(new Error(`Spotify ha rechazado las credenciales (${res.status}). Revisa el ID y el secreto, y que la cuenta dueña de la app tenga Premium.`), { code: 'credenciales' });
  const js = await res.json();
  token = { value: js.access_token, exp: Date.now() + (Number(js.expires_in) || 3600) * 1000 };
  return token.value;
}

async function api(path: string): Promise<any> {
  const t = await getToken();
  const res = await fetch(`https://api.spotify.com/v1/${path}`, { headers: { Authorization: `Bearer ${t}` } });
  if (res.status === 401) { token = null; throw new Error('El permiso de Spotify ha caducado, vuelve a intentarlo.'); }
  if (res.status === 429) throw Object.assign(new Error('Spotify pide esperar un momento.'), { code: 'espera' });
  if (!res.ok) throw new Error(`Spotify ${res.status}`);
  return res.json();
}

const norm = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\s*[([].*?[)\]]\s*/g, ' ').replace(/\b(deluxe|remaster(ed)?|edition|edicion|version|expanded|anniversary)\b/g, ' ')
  .replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
const clip = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    let artist = '', album = '';
    if (req.method === 'POST') { const b = await req.json().catch(() => ({})); artist = clip(b.artist); album = clip(b.album); }
    else { const u = new URL(req.url); artist = clip(u.searchParams.get('artist')); album = clip(u.searchParams.get('album')); }
    if (!album) return json({ ok: false, code: 'falta_album', message: 'Falta el nombre del álbum.' }, 400);
    const market = 'ES';
    const queries = [artist ? `album:${album} artist:${artist}` : `album:${album}`, `${artist} ${album}`.trim()];
    let found: any = null;
    for (const q of queries) {
      const js = await api(`search?type=album&limit=10&market=${market}&q=${encodeURIComponent(q)}`);
      const items: any[] = js?.albums?.items || [];
      const na = norm(album), nr = norm(artist);
      const byArtist = (x: any) => !nr || (x.artists || []).some((a: any) => norm(a.name) === nr || norm(a.name).includes(nr) || nr.includes(norm(a.name)));
      found = items.find((x) => norm(x.name) === na && byArtist(x))
        || items.find((x) => (norm(x.name).includes(na) || na.includes(norm(x.name))) && byArtist(x))
        || (q === queries[0] ? null : items.find(byArtist) || null);
      if (found) break;
    }
    if (!found) return json({ ok: false, code: 'no_encontrado', message: 'No está en Spotify con ese nombre.' });
    const tracks = await api(`albums/${found.id}/tracks?limit=1&market=${market}`);
    const first = tracks?.items?.[0] || null;
    return json({
      ok: true,
      albumId: found.id, albumName: found.name, artist: (found.artists || []).map((a: any) => a.name).join(', '),
      image: found.images?.[0]?.url || null,
      trackId: first?.id || null, trackName: first?.name || null
    });
  } catch (e) {
    const err = e as Error & { code?: string };
    return json({ ok: false, code: err.code || 'error', message: err.message || 'No se pudo consultar Spotify.' }, err.code === 'sin_configurar' ? 503 : 502);
  }
});
