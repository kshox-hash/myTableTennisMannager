-- ============================================================
--  028 — Bitácora de actividad por torneo
--  Registra acciones administrativas clave (cancelar, editar,
--  asignar/liberar mesa, deshacer resultado, generar cuadro) para
--  poder ver después quién hizo qué y cuándo.
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_log (
  id_activity   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_tournament UUID NOT NULL REFERENCES tournaments(id_tournament) ON DELETE CASCADE,
  id_user       UUID NOT NULL REFERENCES users(id_user),
  action        VARCHAR(60) NOT NULL,
  detail        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_log_tournament ON activity_log(id_tournament, created_at DESC);
