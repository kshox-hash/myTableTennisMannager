-- group_matches.id_tournament es una columna denormalizada real (no solo
-- accesible vía category_groups), pero nunca tuvo índice propio — a
-- diferencia de bracket_matches, que sí tiene un índice compuesto que
-- arranca con id_tournament. Encontrado al verificar con EXPLAIN ANALYZE
-- la paginación nueva de "partidos públicos de un torneo" (que filtra
-- group_matches.id_tournament directo, sin pasar por category_groups):
-- Seq Scan de la tabla entera, ~8.5ms de los ~13ms totales de la consulta
-- con solo 32k filas — va a empeorar a medida que crezca.
CREATE INDEX IF NOT EXISTS idx_group_matches_tournament ON group_matches (id_tournament);
