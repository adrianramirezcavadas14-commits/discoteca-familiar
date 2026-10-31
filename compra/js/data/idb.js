/* =====================================================================
   Caché local con IndexedDB (funciona sin conexión dentro del súper)
   Almacenes:
     kv       → datos pequeños (zonas, reglas, listas, sesión, ajustes…)
     products → catálogo (clave: id)
     thumbs   → miniaturas de la lista pendiente (clave: URL → Blob)
     ops      → cola de operaciones pendientes de enviar
   Si IndexedDB no está disponible (modo privado estricto), se usa memoria.
   ===================================================================== */

const DB_NAME = 'hogar-despensa';
const DB_VERSION = 1;
const STORES = { kv: { keyPath: null }, products: { keyPath: 'id' }, thumbs: { keyPath: null }, ops: { keyPath: 'id' } };

let dbPromise = null;
const memory = { kv: new Map(), products: new Map(), thumbs: new Map(), ops: new Map() };
let useMemory = false;

function open(idbFactory = globalThis.indexedDB) {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (!idbFactory) { useMemory = true; resolve(null); return; }
    let req;
    try { req = idbFactory.open(DB_NAME, DB_VERSION); } catch { useMemory = true; resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, opt] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, opt.keyPath ? { keyPath: opt.keyPath } : undefined);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { useMemory = true; resolve(null); };
    req.onblocked = () => { useMemory = true; resolve(null); };
  });
  return dbPromise;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('IndexedDB abortado'));
  });
}
const reqP = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export const idb = {
  /** Para pruebas: permite usar fake-indexeddb. */
  async init(factory) { dbPromise = null; useMemory = false; return open(factory); },
  get inMemory() { return useMemory; },

  async get(store, key) {
    const db = await open();
    if (!db) return memory[store].get(key);
    return tx(db, store, 'readonly', (s) => reqP(s.get(key)));
  },
  async set(store, key, value) {
    const db = await open();
    if (!db) { memory[store].set(key ?? value.id, value); return; }
    return tx(db, store, 'readwrite', (s) => { STORES[store].keyPath ? s.put(value) : s.put(value, key); });
  },
  async del(store, key) {
    const db = await open();
    if (!db) { memory[store].delete(key); return; }
    return tx(db, store, 'readwrite', (s) => { s.delete(key); });
  },
  async all(store) {
    const db = await open();
    if (!db) return [...memory[store].values()];
    return tx(db, store, 'readonly', (s) => reqP(s.getAll()));
  },
  async keys(store) {
    const db = await open();
    if (!db) return [...memory[store].keys()];
    return tx(db, store, 'readonly', (s) => reqP(s.getAllKeys()));
  },
  async putMany(store, values) {
    const db = await open();
    if (!db) { values.forEach((v) => memory[store].set(v.id, v)); return; }
    for (let i = 0; i < values.length; i += 500) {
      const chunk = values.slice(i, i + 500);
      await tx(db, store, 'readwrite', (s) => { chunk.forEach((v) => s.put(v)); });
    }
  },
  async clear(store) {
    const db = await open();
    if (!db) { memory[store].clear(); return; }
    return tx(db, store, 'readwrite', (s) => { s.clear(); });
  }
};
