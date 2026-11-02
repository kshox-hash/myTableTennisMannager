-- ============================================================
--  081 — Club con el que juega en un campeonato
--
--  El club es de palabra: el organizador puede anotar por qué club juega
--  alguien en una categoría sin tocar su perfil ni su sello de verificado.
--  NULL = juega por el club de su perfil.
-- ============================================================

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS club_override UUID REFERENCES clubs(id_club) ON DELETE SET NULL;
