-- ============================================================
--  053 — "Empezar campeonato" queda bloqueado de verdad, no solo en
--  memoria del navegador (con F5 se perdía el bloqueo y el botón
--  volvía a aparecer disponible aunque el admin ya estuviera armando
--  el sembrado sin confirmar todavía).
-- ============================================================

ALTER TABLE tournament_categories
  ADD COLUMN IF NOT EXISTS seeding_in_progress BOOLEAN NOT NULL DEFAULT FALSE;
