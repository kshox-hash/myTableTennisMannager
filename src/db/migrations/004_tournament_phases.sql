-- ============================================================
--  004 — Fases del torneo por categoría
--  Agrega control de fase (enrollment→groups→bracket→finished)
--  y configuración de inicio (manual, auto, scheduled)
-- ============================================================

ALTER TABLE tournament_categories
  ADD COLUMN IF NOT EXISTS phase VARCHAR(20) NOT NULL DEFAULT 'enrollment'
    CHECK (phase IN ('enrollment', 'groups', 'bracket', 'finished')),

  -- Modo de inicio de la fase de grupos
  ADD COLUMN IF NOT EXISTS groups_start_mode VARCHAR(20) NOT NULL DEFAULT 'manual'
    CHECK (groups_start_mode IN ('manual', 'auto', 'scheduled')),

  -- Hora programada para iniciar grupos (solo si groups_start_mode = 'scheduled')
  ADD COLUMN IF NOT EXISTS scheduled_groups_at TIMESTAMPTZ,

  -- Modo de inicio del cuadro eliminatorio
  ADD COLUMN IF NOT EXISTS bracket_start_mode VARCHAR(20) NOT NULL DEFAULT 'manual'
    CHECK (bracket_start_mode IN ('manual', 'auto', 'scheduled')),

  -- Hora programada para iniciar llaves (solo si bracket_start_mode = 'scheduled')
  ADD COLUMN IF NOT EXISTS scheduled_bracket_at TIMESTAMPTZ;
