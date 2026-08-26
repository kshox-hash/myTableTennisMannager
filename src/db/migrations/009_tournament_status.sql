-- ============================================================
--  009 — Estado del torneo (permite cancelar de verdad)
-- ============================================================

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tournaments_status_check'
  ) THEN
    ALTER TABLE tournaments
      ADD CONSTRAINT tournaments_status_check
      CHECK (status IN ('active', 'cancelled'));
  END IF;
END $$;
