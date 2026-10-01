-- ============================================================
--  066 — Campeonato finalizado antes de tiempo
-- ============================================================
-- El organizador puede finalizar el campeonato en cualquier momento: las
-- categorías que no habían terminado quedan 'finished' con esta marca (se
-- cortaron a medias), y por eso NO tienen podio ni medallas.
ALTER TABLE tournament_categories
  ADD COLUMN IF NOT EXISTS finished_early BOOLEAN NOT NULL DEFAULT false;
