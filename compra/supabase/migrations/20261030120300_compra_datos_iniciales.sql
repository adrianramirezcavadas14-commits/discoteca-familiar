-- =====================================================================
-- HOGAR · NUESTRA DESPENSA FAMILIAR · 4/4 · Datos iniciales
-- ---------------------------------------------------------------------
-- Familia, perfiles (Papá, Mamá, Adrián), tienda, las 15 zonas del mapa,
-- reglas de zona por IDENTIFICADOR de categoría de Mercadona, ajustes y
-- el bucket privado de tickets. Idempotente: no duplica nada si se repite.
--
-- Identificadores de categoría comprobados en el catálogo real
-- (datania/mercadona-catalog · categories.json, octubre de 2026).
-- Nivel 0 = sección (p. ej. 5 «Panadería y pastelería»)
-- Nivel 1 = categoría (p. ej. 66 «Bollería envasada»)
-- =====================================================================

-- Identificadores fijos para que la migración sea reproducible
-- familia  00000000-0000-4000-8000-000000000001
-- tienda   00000000-0000-4000-8000-000000000101
insert into compra.households (id, name)
values ('00000000-0000-4000-8000-000000000001', 'Nuestra casa')
on conflict (id) do nothing;

insert into compra.family_profiles (id, household_id, code, display_name, color, sort_order, can_shop) values
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'papa',   'Papá',   '#ef6f6c', 1, true),
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000001', 'mama',   'Mamá',   '#8f6fc5', 2, true),
  ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000001', 'adrian', 'Adrián', '#3e9c87', 3, true)
on conflict (household_id, code) do nothing;

insert into compra.household_members (household_id, profile_id, role)
select '00000000-0000-4000-8000-000000000001', id, case when code in ('papa', 'mama') then 'admin' else 'member' end
from compra.family_profiles where household_id = '00000000-0000-4000-8000-000000000001'
on conflict (household_id, profile_id) do nothing;

insert into compra.stores (id, household_id, name, is_default)
values ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'Nuestro Mercadona', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Zonas. map_shapes: rectángulos en una cuadrícula de 100 × 50 celdas
-- (x, y = esquina superior izquierda empezando en 1; w, h = ancho y alto; r = giro en grados;
--  lp = "end" coloca el número y el nombre abajo, p. ej. en fruta y verdura, donde está el arcón).
-- Se reproducen la forma y posición aproximadas del mapa conceptual.
-- ---------------------------------------------------------------------
insert into compra.store_zones (id, household_id, store_id, code, route_order, name, summary, color, map_shapes, notes) values
  ('00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z01', 1,
   'Salsas, agua y caldos', 'Salsas · Aceitunas · Agua · Caldos', '#e5484d',
   '[{"x":8,"y":38,"w":39,"h":5}]', null),
  ('00000000-0000-4000-8000-000000001002', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z02', 2,
   'Desayunos y yogures', 'Cereales · Yogures · Mantequilla', '#6fbf4a',
   '[{"x":1,"y":14,"w":6,"h":29}]', null),
  ('00000000-0000-4000-8000-000000001003', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z03', 3,
   'Panadería', 'Pan · Pastelería', '#1ea5e0',
   '[{"x":1,"y":1,"w":15,"h":12}]', 'Toda la sección de panadería y pastelería excepto la bollería envasada.'),
  ('00000000-0000-4000-8000-000000001004', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z04', 4,
   'Leche, zumos y dulces', 'Bollería envasada · Leche · Zumos · Dulces', '#2f3d94',
   '[{"x":9,"y":14,"w":7,"h":23}]', null),
  ('00000000-0000-4000-8000-000000001005', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z05', 5,
   'Charcutería y platos preparados', 'Charcutería · Quesos · Pizzas', '#a58fd6',
   '[{"x":18,"y":22,"w":9,"h":15}]', null),
  ('00000000-0000-4000-8000-000000001006', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z06', 6,
   'Carne, especias y café', 'Carne · Especias · Café', '#b34d5a',
   '[{"x":18,"y":1,"w":9,"h":16}]', null),
  ('00000000-0000-4000-8000-000000001007', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z07', 7,
   'Conservas y frutos secos', 'Conservas · Frutos secos', '#f29a1d',
   '[{"x":29,"y":1,"w":8,"h":12}]', null),
  ('00000000-0000-4000-8000-000000001008', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z08', 8,
   'Snacks y refrescos', 'Patatas fritas · Refrescos', '#6b3fa0',
   '[{"x":29,"y":17,"w":8,"h":20}]', null),
  ('00000000-0000-4000-8000-000000001009', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z09', 9,
   'Bodega, huevos y aceite', 'Bodega · Huevos · Aceite', '#5d7c35',
   '[{"x":39,"y":17,"w":8,"h":20}]', null),
  ('00000000-0000-4000-8000-000000001010', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z10', 10,
   'Fruta y verdura', 'Fruta · Verdura', '#ef9f68',
   '[{"x":49,"y":15,"w":14,"h":22,"lp":"end"}]', null),
  ('00000000-0000-4000-8000-000000001011', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z11', 11,
   'Arroz, pasta y papel', 'Arroz · Pasta · Papel · Menaje', '#e3336f',
   '[{"x":65,"y":11,"w":9,"h":26}]', null),
  ('00000000-0000-4000-8000-000000001012', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z12', 12,
   'Limpieza', 'Detergentes · Lejía · Limpieza', '#8fa6c4',
   '[{"x":76,"y":5,"w":8,"h":32}]', null),
  ('00000000-0000-4000-8000-000000001013', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z13', 13,
   'Cuidado personal', 'Maquillaje · Cuidado facial · Cabello', '#2f7f93',
   '[{"x":86,"y":5,"w":14,"h":32}]', null),
  ('00000000-0000-4000-8000-000000001014', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z14', 14,
   'Pescado y marisco', 'Pescado · Marisco', '#7fae8f',
   '[{"x":50,"y":1,"w":50,"h":3}]', null),
  ('00000000-0000-4000-8000-000000001015', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z15', 15,
   'Congelados', 'Congelados', '#f2cf1d',
   '[{"x":38,"y":6,"w":21,"h":3,"r":20},{"x":55,"y":17,"w":3,"h":13},{"x":63,"y":10,"w":2,"h":4}]',
   'Los tres arcones amarillos del mapa forman una sola zona.')
on conflict (store_id, code) do nothing;

-- ---------------------------------------------------------------------
-- Reglas por identificador (nivel 0 = sección, nivel 1 = categoría).
-- La regla más específica gana: «Panadería y pastelería» (sección 5) va a la
-- zona 3, pero «Bollería envasada» (66) tiene su propia regla a la zona 4.
-- ---------------------------------------------------------------------
with z as (select code, id from compra.store_zones where store_id = '00000000-0000-4000-8000-000000000101'),
r(level, cat_id, cat_name, zone_code) as (values
  -- Zona 1 · Salsas · Aceitunas y encurtidos · Agua · Caldos y cremas
  (1, 116, 'Mayonesa, ketchup y mostaza', 'z01'),
  (1, 117, 'Otras salsas', 'z01'),
  (1, 135, 'Aceitunas y encurtidos', 'z01'),
  (1, 156, 'Agua', 'z01'),
  (1, 129, 'Sopa y caldo', 'z01'),
  (1, 130, 'Gazpacho y cremas', 'z01'),
  -- Zona 2 · Cereales y galletas · Postres y yogures · Mantequilla y margarina
  (0,   7, 'Cereales y galletas', 'z02'),
  (0,  11, 'Postres y yogures', 'z02'),
  (1,  75, 'Mantequilla y margarina', 'z02'),
  -- Zona 3 · Panadería y pastelería (excepto Bollería envasada)
  (0,   5, 'Panadería y pastelería', 'z03'),
  -- Zona 4 · Bollería envasada · Leche y bebidas vegetales · Zumos · Azúcar, caramelos y chocolate
  (1,  66, 'Bollería envasada', 'z04'),
  (1,  72, 'Leche y bebidas vegetales', 'z04'),
  (0,  10, 'Zumos', 'z04'),
  (0,   9, 'Azúcar, caramelos y chocolate', 'z04'),
  -- Zona 5 · Charcutería y quesos · Pizzas y platos preparados
  (0,   4, 'Charcutería y quesos', 'z05'),
  (0,  16, 'Pizzas y platos preparados', 'z05'),
  -- Zona 6 · Carne · Especias · Cacao, café e infusiones
  (0,   3, 'Carne', 'z06'),
  (1, 115, 'Especias', 'z06'),
  (0,   8, 'Cacao, café e infusiones', 'z06'),
  -- Zona 7 · Conservas · Frutos secos y fruta desecada
  (0,  14, 'Conservas, caldos y cremas', 'z07'),   -- caldos y cremas tienen regla propia (zona 1)
  (1, 133, 'Frutos secos y fruta desecada', 'z07'),
  -- Zona 8 · Patatas fritas y snacks · Refrescos
  (1, 132, 'Patatas fritas y snacks', 'z08'),
  (0,  18, 'Agua y refrescos', 'z08'),             -- el agua tiene regla propia (zona 1)
  -- Zona 9 · Bodega · Huevos · Aceite, vinagre y sal
  (0,  19, 'Bodega', 'z09'),
  (1,  77, 'Huevos', 'z09'),
  (1, 112, 'Aceite, vinagre y sal', 'z09'),
  -- Zona 10 · Fruta y verdura
  (0,   1, 'Fruta y verdura', 'z10'),
  -- Zona 11 · Arroz, legumbres y pasta · Papel higiénico y celulosa · Menaje y conservación · Pilas y bolsas de basura
  (0,  13, 'Arroz, legumbres y pasta', 'z11'),
  (1, 238, 'Papel higiénico y celulosa', 'z11'),
  (1, 243, 'Menaje y conservación de alimentos', 'z11'),
  (1, 239, 'Pilas y bolsas de basura', 'z11'),
  -- Zona 12 · Limpieza
  (1, 226, 'Detergente y suavizante ropa', 'z12'),
  (1, 237, 'Estropajo, bayeta y guantes', 'z12'),
  (1, 241, 'Insecticida y ambientador', 'z12'),
  (1, 234, 'Lejía y líquidos fuertes', 'z12'),
  (1, 235, 'Limpiacristales', 'z12'),
  (1, 233, 'Limpiahogar y friegasuelos', 'z12'),
  (1, 231, 'Limpieza baño y WC', 'z12'),
  (1, 230, 'Limpieza cocina', 'z12'),
  (1, 232, 'Limpieza muebles y multiusos', 'z12'),
  (1, 229, 'Limpieza vajilla', 'z12'),
  -- Zona 13 · Maquillaje · Cuidado facial y corporal · Cuidado del cabello · Fitoterapia y parafarmacia
  (0,  22, 'Maquillaje', 'z13'),
  (0,  20, 'Cuidado facial y corporal', 'z13'),
  (0,  21, 'Cuidado del cabello', 'z13'),
  (0,  23, 'Fitoterapia y parafarmacia', 'z13'),
  -- Zona 14 · Marisco y pescado
  (0,   2, 'Marisco y pescado', 'z14'),
  -- Zona 15 · Congelados
  (0,  17, 'Congelados', 'z15')
)
insert into compra.category_zone_rules (household_id, store_id, zone_id, level, external_category_id, category_name, source, confirmed)
select '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', z.id, r.level, r.cat_id, r.cat_name, 'seed', true
from r join z on z.code = r.zone_code
on conflict (store_id, level, external_category_id) do nothing;

-- Ajustes iniciales
insert into compra.app_settings (household_id, key, value) values
  ('00000000-0000-4000-8000-000000000001', 'sync_interval_hours', '12'),
  ('00000000-0000-4000-8000-000000000001', 'hidden_category_ids', '[24, 25]'),          -- Bebé y Mascotas
  ('00000000-0000-4000-8000-000000000001', 'hidden_category_names', '["Bebé", "Mascotas"]'),
  ('00000000-0000-4000-8000-000000000001', 'manual_confirm_category_ids', '[]')
on conflict (household_id, key) do nothing;

-- ---------------------------------------------------------------------
-- Bucket PRIVADO para tickets (solo accesible desde la función Edge)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('compra-tickets', 'compra-tickets', false, 10485760,
            array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;
