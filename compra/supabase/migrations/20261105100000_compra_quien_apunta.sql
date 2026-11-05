-- =====================================================================
-- HOGAR · NUESTRA DESPENSA FAMILIAR · 9 · Quién apuntó cada producto (versión 1.3)
-- ---------------------------------------------------------------------
--  La app ya guarda quién añade cada producto (added_by, al crear la fila).
--  Este cambio solo hace que, al MOVER un producto entre la lista principal y
--  «Pendientes no urgentes», se conserve la persona que lo apuntó en su día
--  (antes pasaba a ser quien lo movía). No cambia ni borra datos.
--  Es seguro ejecutarlo varias veces.
-- =====================================================================

create or replace function compra.move_between_lists(p_product_id uuid, p_to text, p_actor text default null, p_op_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := compra.require_household();
  actor uuid := compra.profile_id(h, p_actor);
  l compra.shopping_lists%rowtype;
  it compra.shopping_list_items%rowtype;
  b compra.backlog_items%rowtype;
  p record; r jsonb; moved integer;
begin
  if p_op_id is not null then r := compra.op_result(h, p_op_id); if r is not null then return r; end if; end if;
  if p_to not in ('backlog', 'main') then perform compra.fail('destino_no_valido', 'Destino no válido.'); end if;
  select * into l from compra.shopping_lists where household_id = h and status = 'draft' and deleted_at is null for update;

  if p_to = 'backlog' then
    if l.id is not null then select * into it from compra.shopping_list_items where list_id = l.id and product_id = p_product_id for update; end if;
    if it.id is null then perform compra.fail('no_esta_en_la_lista', 'Ese producto ya no está en la lista principal.'); end if;
    moved := it.quantity;
    delete from compra.shopping_list_items where id = it.id;
    insert into compra.backlog_items (household_id, product_id, quantity, notes, added_by)
    values (h, p_product_id, least(99, moved), it.notes, coalesce(it.added_by, actor))
    on conflict (household_id, product_id) do update
      set quantity = least(99, compra.backlog_items.quantity + excluded.quantity),
          notes = coalesce(compra.backlog_items.notes, excluded.notes);
    perform compra.recalc_list(l.id);
  else
    select * into b from compra.backlog_items where household_id = h and product_id = p_product_id for update;
    if b.id is null then perform compra.fail('no_esta_en_pendientes', 'Ese producto ya no está en «Pendientes no urgentes».'); end if;
    select id, price, previous_price, price_decreased, visible_in_app into p from compra.products where id = p_product_id and deleted_at is null;
    if p.id is null then perform compra.fail('producto_no_existe', 'Ese producto ya no existe en el catálogo.'); end if;
    if not p.visible_in_app then perform compra.fail('producto_oculto', 'Ese producto pertenece a una categoría oculta.'); end if;
    if l.id is null then
      insert into compra.shopping_lists (household_id, store_id, created_by) values (h, compra.default_store(h), actor) returning * into l;
    end if;
    moved := b.quantity;
    delete from compra.backlog_items where id = b.id;
    insert into compra.shopping_list_items (household_id, list_id, product_id, quantity, unit_price_snapshot, regular_price_snapshot, notes, added_by)
    values (h, l.id, p_product_id, least(99, moved), p.price, case when p.price_decreased then p.previous_price end, b.notes, coalesce(b.added_by, actor))
    on conflict (list_id, product_id) do update
      set quantity = least(99, compra.shopping_list_items.quantity + excluded.quantity),
          notes = coalesce(compra.shopping_list_items.notes, excluded.notes);
    if (select count(*) from compra.shopping_list_items where list_id = l.id) > 400 then
      perform compra.fail('lista_demasiado_grande', 'La lista no puede tener más de 400 productos distintos.');
    end if;
    perform compra.recalc_list(l.id);
  end if;

  perform compra.audit(h, actor, 'move_between_lists', 'products', p_product_id::text, jsonb_build_object('to', p_to, 'quantity', moved));
  r := jsonb_build_object('to', p_to, 'quantity', moved,
         'draft', case when l.id is null then null else compra.list_payload(l.id) end,
         'backlog', compra.backlog_payload(h));
  return compra.op_store(h, p_op_id, 'move_between_lists', r);
end $$;

