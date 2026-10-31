// =====================================================================
// DATOS DE PRUEBA (solo para tests). Reproducen la ESTRUCTURA real de la
// API de Mercadona / datania (categories.json y categories/<id>.json),
// comprobada con los archivos publicados, pero los productos y precios
// son inventados y nunca se cargan en Supabase real.
// =====================================================================

export function product({ id, name, section, price, ref = null, fmt = 'kg', size = 1, packaging = 'Paquete', thumb = null, decreased = false, previous = null, published = true, unavailableFrom = null, isNew = false }) {
  return {
    badges: { is_water: false, requires_age_check: false },
    categories: [{ id: section.id, level: 0, name: section.name, order: 1 }],
    display_name: name,
    id: String(id),
    is_new_arrival: isNew,
    limit: 999,
    main_feature: '',
    packaging,
    price_instructions: {
      approx_size: false, bulk_price: (ref ?? price).toFixed(2), bunch_selector: false, drained_weight: null,
      increment_bunch_amount: 1.0, is_new: false, is_pack: false, iva: null, min_bunch_amount: 1.0, pack_size: null,
      previous_unit_price: previous == null ? null : previous.toFixed(2), price_decreased: decreased,
      reference_format: fmt.toUpperCase(), reference_price: (ref ?? price).toFixed(3), selling_method: 0,
      size_format: fmt, tax_percentage: '10.000', total_units: null, unit_name: null,
      unit_price: price.toFixed(2), unit_selector: true, unit_size: size
    },
    published,
    share_url: `https://tienda.mercadona.es/product/${id}/prueba`,
    slug: 'prueba',
    status: null,
    thumbnail: thumb || `https://prod-mercadona.imgix.net/images/test${id}.jpg?fit=crop&h=300&w=300`,
    unavailable_from: unavailableFrom,
    unavailable_weekdays: []
  };
}

export const SECTIONS = {
  aceite: { id: 12, name: 'Aceite, especias y salsas' },
  pan: { id: 5, name: 'Panadería y pastelería' },
  bebe: { id: 24, name: 'Bebé' },
  limpieza: { id: 26, name: 'Limpieza y hogar' }
};

/** Catálogo base: devuelve { root, categories: {id: payload} } */
export function baseCatalog(mutate = (c) => c) {
  const S = SECTIONS;
  const cats = {
    112: { id: 112, name: 'Aceite, vinagre y sal', subs: [
      { id: 420, name: 'Aceite de oliva', products: [
        product({ id: 4241, name: 'Aceite de oliva 0,4º (prueba)', section: S.aceite, price: 17.25, ref: 3.45, fmt: 'l', size: 5, packaging: 'Garrafa' }),
        product({ id: 4242, name: 'Aceite de oliva virgen (prueba)', section: S.aceite, price: 6.10, fmt: 'l', packaging: 'Botella' }) ] },
      { id: 424, name: 'Sal y bicarbonato', products: [
        product({ id: 4300, name: 'Sal fina (prueba)', section: S.aceite, price: 0.35, packaging: 'Paquete' }) ] } ] },
    116: { id: 116, name: 'Mayonesa, ketchup y mostaza', subs: [
      { id: 460, name: 'Mayonesa', products: [
        product({ id: 5001, name: 'Mayonesa (prueba)', section: S.aceite, price: 1.20, fmt: 'l', size: 0.45, packaging: 'Bote' }) ] } ] },
    66: { id: 66, name: 'Bollería envasada', subs: [
      { id: 600, name: 'Magdalenas', products: [
        product({ id: 6001, name: 'Magdalenas (prueba)', section: S.pan, price: 1.50, packaging: 'Paquete' }) ] } ] },
    59: { id: 59, name: 'Pan de horno', subs: [
      { id: 590, name: 'Barras', products: [
        product({ id: 5901, name: 'Barra de pan (prueba)', section: S.pan, price: 0.45, packaging: 'Pieza' }) ] } ] },
    216: { id: 216, name: 'Alimentación infantil', subs: [
      { id: 2160, name: 'Potitos', products: [
        product({ id: 21601, name: 'Potito (prueba)', section: S.bebe, price: 1.10, packaging: 'Tarro' }) ] } ] },
    244: { id: 244, name: 'Utensilios de limpieza y calzado', subs: [
      { id: 2440, name: 'Fregonas', products: [
        product({ id: 24401, name: 'Fregona (prueba)', section: S.limpieza, price: 2.00, packaging: 'Unidad' }) ] } ] }
  };
  mutate(cats);
  const sectionOf = { 112: S.aceite, 116: S.aceite, 66: S.pan, 59: S.pan, 216: S.bebe, 244: S.limpieza };
  const bySection = new Map();
  for (const id of Object.keys(cats)) {
    const sec = sectionOf[id] || S.aceite;
    if (!bySection.has(sec.id)) bySection.set(sec.id, { id: sec.id, name: sec.name, order: 1, is_extended: false, icon_url: null, categories: [] });
    bySection.get(sec.id).categories.push({ id: Number(id), name: cats[id].name, order: 1, layout: 1, published: true, is_extended: false });
  }
  const root = { count: bySection.size, next: null, previous: null, results: [...bySection.values()] };
  const categories = {};
  for (const [id, c] of Object.entries(cats)) {
    categories[id] = {
      id: Number(id), name: c.name, order: 1, layout: 1, published: true, is_extended: false, next_category: null,
      categories: c.subs.map((s) => ({ id: s.id, name: s.name, order: 1, layout: 2, published: true, is_extended: false, image: null, subtitle: null, products: s.products }))
    };
  }
  return { root, categories };
}

/** Proveedor falso con la misma interfaz que MercadonaCatalogProvider. */
export function fakeProvider(name, catalog, { failCategories = [], failRoot = false } = {}) {
  const calls = [];
  return {
    name, calls,
    async listCategories() {
      calls.push('root');
      if (failRoot) throw new Error(`${name}: raíz no disponible`);
      const { parseCategoriesRoot } = await import('../../supabase/functions/_shared/catalog-core.js');
      return parseCategoriesRoot(catalog.root);
    },
    async fetchCategory(id) {
      calls.push(`cat:${id}`);
      if (failCategories.includes(Number(id))) throw new Error(`${name}: categoría ${id} no disponible`);
      const c = catalog.categories[id];
      if (!c) throw new Error('404');
      return JSON.parse(JSON.stringify(c));
    },
    async fetchProduct(id) {
      calls.push(`prod:${id}`);
      return { id, ean: '8480000' + String(id).padStart(6, '0'), brand: 'Marca de prueba', details: { description: `Descripción de prueba ${id}` }, photos: [] };
    }
  };
}

/* Catálogo de prueba más grande para las pruebas de interfaz: usa los identificadores
   REALES de categorías (para que caigan en sus zonas) pero productos y precios inventados. */
const RICH = [
  [12, 'Aceite, especias y salsas', [[112, 'Aceite, vinagre y sal'], [115, 'Especias'], [116, 'Mayonesa, ketchup y mostaza'], [117, 'Otras salsas']]],
  [18, 'Agua y refrescos', [[156, 'Agua'], [158, 'Refresco de cola'], [159, 'Refresco de naranja y de limón']]],
  [15, 'Aperitivos', [[135, 'Aceitunas y encurtidos'], [133, 'Frutos secos y fruta desecada'], [132, 'Patatas fritas y snacks']]],
  [13, 'Arroz, legumbres y pasta', [[118, 'Arroz'], [121, 'Legumbres'], [120, 'Pasta y fideos']]],
  [9, 'Azúcar, caramelos y chocolate', [[89, 'Azúcar y edulcorante'], [92, 'Chocolate']]],
  [24, 'Bebé', [[216, 'Alimentación infantil']]],
  [19, 'Bodega', [[164, 'Cerveza'], [169, 'Vino tinto']]],
  [8, 'Cacao, café e infusiones', [[83, 'Café molido y en grano'], [88, 'Té e infusiones']]],
  [3, 'Carne', [[38, 'Aves y pollo'], [37, 'Cerdo']]],
  [7, 'Cereales y galletas', [[78, 'Cereales'], [80, 'Galletas']]],
  [4, 'Charcutería y quesos', [[48, 'Aves y jamón cocido'], [54, 'Queso curado, semicurado y tierno']]],
  [17, 'Congelados', [[154, 'Helados'], [145, 'Fruta y verdura']]],
  [14, 'Conservas, caldos y cremas', [[122, 'Atún y otras conservas de pescado'], [129, 'Sopa y caldo']]],
  [20, 'Cuidado facial y corporal', [[186, 'Higiene bucal'], [187, 'Gel y jabón de manos']]],
  [1, 'Fruta y verdura', [[27, 'Fruta'], [29, 'Verdura']]],
  [6, 'Huevos, leche y mantequilla', [[77, 'Huevos'], [72, 'Leche y bebidas vegetales'], [75, 'Mantequilla y margarina']]],
  [26, 'Limpieza y hogar', [[226, 'Detergente y suavizante ropa'], [238, 'Papel higiénico y celulosa'], [244, 'Utensilios de limpieza y calzado']]],
  [2, 'Marisco y pescado', [[31, 'Pescado fresco'], [32, 'Marisco']]],
  [25, 'Mascotas', [[221, 'Perro']]],
  [5, 'Panadería y pastelería', [[59, 'Pan de horno'], [66, 'Bollería envasada']]],
  [16, 'Pizzas y platos preparados', [[138, 'Pizzas']]],
  [11, 'Postres y yogures', [[104, 'Yogures naturales y sabores']]],
  [10, 'Zumos', [[143, 'Naranja']]]
];
const PACK = ['Paquete', 'Botella', 'Brik', 'Bote', 'Lata', 'Bandeja', 'Pieza', 'Caja'];
export function richCatalog(mutate = (c) => c) {
  const cats = {};
  let pid = 100000;
  const sectionOf = {};
  for (const [secId, secName, list] of RICH) {
    for (const [cid, cname] of list) {
      sectionOf[cid] = { id: secId, name: secName };
      const n = 6 + (cid % 9);
      const products = Array.from({ length: n }, (_, i) => {
        const price = Math.round((0.6 + ((cid * 7 + i * 13) % 90) / 10) * 100) / 100;
        return product({ id: ++pid, name: `${cname} ${['clásico', 'suave', 'familiar', 'extra', 'ligero', 'natural', 'selección', 'tradicional', 'ecológico', 'mini', 'grande', 'casero', 'intenso', 'original', 'especial'][i % 15]} (prueba)`,
          section: { id: secId, name: secName }, price, packaging: PACK[(cid + i) % PACK.length], size: 1 + (i % 3), fmt: ['kg', 'l', 'ud'][i % 3] === 'ud' ? 'ud' : ['kg', 'l'][i % 2] });
      });
      cats[cid] = { id: cid, name: cname, subs: [{ id: cid * 10 + 1, name: cname, products }] };
    }
  }
  mutate(cats);
  const bySection = new Map();
  for (const id of Object.keys(cats)) {
    const sec = sectionOf[id];
    if (!bySection.has(sec.id)) bySection.set(sec.id, { id: sec.id, name: sec.name, order: 1, is_extended: false, icon_url: null, categories: [] });
    bySection.get(sec.id).categories.push({ id: Number(id), name: cats[id].name, order: 1, layout: 1, published: true, is_extended: false });
  }
  const root = { count: bySection.size, next: null, previous: null, results: [...bySection.values()] };
  const categories = {};
  for (const [id, c] of Object.entries(cats)) {
    categories[id] = { id: Number(id), name: c.name, order: 1, layout: 1, published: true, is_extended: false, next_category: null,
      categories: c.subs.map((s) => ({ id: s.id, name: s.name, order: 1, layout: 2, published: true, is_extended: false, image: null, subtitle: null, products: s.products })) };
  }
  return { root, categories };
}
