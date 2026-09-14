-- Los grupos MANUALES (group_kind = 'manual') ya no tienen que respetar el
-- tamaño 2/3/4 que sí necesitan los grupos automáticos (todos-contra-todos
-- generado por el algoritmo) — a pedido: se puede crear un grupo manual
-- vacío (0 jugadores) y agregarle cualquier cantidad después. El límite de
-- 2/3/4 para los grupos AUTOMÁTICOS sigue existiendo, pero se aplica en el
-- código (generateGroupsFromPlayers/buildManualGroups), no acá — este CHECK
-- de la tabla no distinguía entre los dos casos, así que había que sacarlo
-- entero y dejar solo la guarda mínima (no negativo).
ALTER TABLE category_groups DROP CONSTRAINT IF EXISTS category_groups_target_size_check;
ALTER TABLE category_groups ADD CONSTRAINT category_groups_target_size_check
  CHECK (target_size >= 0);
