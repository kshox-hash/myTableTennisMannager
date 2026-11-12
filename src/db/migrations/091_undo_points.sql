-- Historial para "deshacer" en Actividad (como un Ctrl+Z).
-- Antes de cada acción del admin sobre una categoría (armar grupos, cargar un
-- resultado, generar la llave...) se guarda cómo estaba la categoría. Deshacer
-- vuelve la categoría a ese estado (y con eso también todo lo que se hizo
-- después en ella).
CREATE TABLE IF NOT EXISTS undo_points (
  id_point      BIGSERIAL PRIMARY KEY,
  id_tournament UUID        NOT NULL REFERENCES tournaments(id_tournament) ON DELETE CASCADE,
  id_user       UUID        REFERENCES users(id_user) ON DELETE SET NULL,
  label         TEXT        NOT NULL,
  detail        TEXT,
  category_ids  UUID[]      NOT NULL,
  -- { "<id_category>": { cat, groups, members, standings, gmatches, bmatches, enrollments, teams } }
  snapshot      JSONB       NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_undo_points_tournament ON undo_points (id_tournament, id_point DESC);
