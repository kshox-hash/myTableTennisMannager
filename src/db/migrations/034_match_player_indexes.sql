-- bracket_matches nunca tuvo índice sobre player1_id/player2_id — cada
-- consulta de "próximo partido" del dashboard del jugador
-- (WHERE player1_id = $1 OR player2_id = $1) forzaba un Seq Scan de la
-- tabla ENTERA, sin importar de qué torneo/jugador se tratara. Medido con
-- EXPLAIN ANALYZE contra 30.000 filas: 10ms de Seq Scan → 0.2ms con estos
-- índices (Bitmap Heap Scan). Ese costo crece con el tamaño total del
-- sistema, no con la cantidad de partidos del jugador, así que empeora
-- solo con el tiempo.
--
-- Dos índices de una sola columna (no uno compuesto) a propósito: para un
-- patrón "col1 = X OR col2 = X", Postgres solo puede usar eficientemente
-- un índice compuesto (col1, col2) en la mitad que tiene a col1 como
-- columna líder — la otra mitad del OR sigue sin índice. Con dos índices
-- de una columna cada uno, el planner arma un BitmapOr y ambas mitades
-- del OR quedan cubiertas.
CREATE INDEX IF NOT EXISTS idx_bracket_matches_player1 ON bracket_matches (player1_id);
CREATE INDEX IF NOT EXISTS idx_bracket_matches_player2 ON bracket_matches (player2_id);

-- group_matches ya tenía idx_group_matches_players (player1_id, player2_id)
-- — ese compuesto sirve bien la mitad "player1_id = $1" (columna líder),
-- pero no la mitad "player2_id = $1" del mismo OR. Este índice nuevo
-- completa el BitmapOr, mismo razonamiento que arriba.
CREATE INDEX IF NOT EXISTS idx_group_matches_player2 ON group_matches (player2_id);
