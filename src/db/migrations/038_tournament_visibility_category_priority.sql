-- ============================================================
--  038 — Visibilidad del torneo + prioridad de categoría
-- ============================================================
-- Visibilidad: 'public' aparece en el listado público sin login (/torneos)
-- y en /player/tournaments para cualquiera; 'private' no aparece en NINGÚN
-- listado, solo se accede con el link directo por id (ver
-- public_tournament_repository.list() y admin_tournament_repository.findAll());
-- 'internal' solo aparece en /player/tournaments para jugadores del mismo
-- club que el organizador (created_by).
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'public';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tournaments_visibility_check'
  ) THEN
    ALTER TABLE tournaments
      ADD CONSTRAINT tournaments_visibility_check
      CHECK (visibility IN ('public', 'private', 'internal'));
  END IF;
END $$;

-- Prioridad de categoría: orden en que se sugiere jugarlas (menor = antes).
-- Dos categorías con el mismo número se interpretan como "en simultáneo".
-- Alimenta como punto de partida el orden inicial del panel de
-- Programación (SchedulePanel.tsx) — el admin lo puede reordenar ahí igual
-- que hoy, esto solo cambia con qué orden arranca.
ALTER TABLE tournament_categories
  ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 1;
