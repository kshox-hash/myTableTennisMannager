-- ============================================================
--  080 — Goma del derecho y del revés del jugador (opcional)
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS forehand_rubber VARCHAR(20)
    CHECK (forehand_rubber IN ('smooth', 'short_pips', 'medium_pips', 'long_pips', 'antispin')),
  ADD COLUMN IF NOT EXISTS backhand_rubber VARCHAR(20)
    CHECK (backhand_rubber IN ('smooth', 'short_pips', 'medium_pips', 'long_pips', 'antispin'));
