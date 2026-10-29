-- Repara categorías trabadas por el error de setPhase (parámetro $1 con
-- "tipos de dato inconsistentes", migración/commit del cierre automático de
-- inscripciones): los grupos o la llave se crearon pero la fase no avanzó.
-- Cada caso deja la categoría en la fase que corresponde a lo que ya existe.

-- Grupos creados con la categoría todavía en inscripción → grupos.
UPDATE tournament_categories tc
SET phase = 'groups',
    status = CASE WHEN tc.status = 'active' THEN 'closed' ELSE tc.status END
WHERE COALESCE(tc.phase, 'enrollment') = 'enrollment'
  AND EXISTS (SELECT 1 FROM category_groups cg WHERE cg.id_category = tc.id_category);

-- Llave creada con la categoría todavía en grupos → llave.
UPDATE tournament_categories tc
SET phase = 'bracket',
    status = CASE WHEN tc.status = 'active' THEN 'closed' ELSE tc.status END
WHERE tc.phase = 'groups'
  AND EXISTS (SELECT 1 FROM bracket_matches bm WHERE bm.id_category = tc.id_category);

-- Llave con todos sus partidos jugados que no se cerró → terminada.
UPDATE tournament_categories tc
SET phase = 'finished'
WHERE tc.phase = 'bracket'
  AND EXISTS (SELECT 1 FROM bracket_matches bm WHERE bm.id_category = tc.id_category)
  AND NOT EXISTS (SELECT 1 FROM bracket_matches bm WHERE bm.id_category = tc.id_category AND bm.winner_id IS NULL);

-- Grupo único (sin llave) con todos sus partidos jugados → terminada.
UPDATE tournament_categories tc
SET phase = 'finished'
WHERE tc.phase = 'groups'
  AND tc.competition_format = 'round_robin'
  AND NOT EXISTS (SELECT 1 FROM bracket_matches bm WHERE bm.id_category = tc.id_category)
  AND EXISTS (
    SELECT 1 FROM group_matches gm JOIN category_groups cg ON cg.id_group = gm.id_group
    WHERE cg.id_category = tc.id_category)
  AND NOT EXISTS (
    SELECT 1 FROM group_matches gm JOIN category_groups cg ON cg.id_group = gm.id_group
    WHERE cg.id_category = tc.id_category AND gm.winner_id IS NULL);
