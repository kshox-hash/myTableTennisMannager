-- group_members solo tenía PRIMARY KEY (id_group, id_user) — con id_group
-- como columna líder, una búsqueda por "todos los grupos de este jugador"
-- (WHERE gm.id_user = $1, sin id_group conocido de antemano) no puede usar
-- esa PK y termina en Seq Scan de la tabla entera, sin importar de qué
-- torneo se trate. Mismo problema exacto que bracket_matches/group_matches
-- sin índice en player1_id/player2_id (migración 034) — este quedó afuera
-- de ese pase. Usado en player_repository.ts para "mi grupo" en el
-- dashboard del jugador y en "Mi categoría".
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members (id_user);
