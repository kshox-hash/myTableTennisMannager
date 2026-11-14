-- ============================================================
--  098 — Un campeonato demo NUNCA es público
--
--  Cualquier campeonato creado por una cuenta demo (users.demo_expires_at)
--  queda marcado is_demo y siempre 'private', aunque desde la cuenta demo
--  se toque "Publicar" o se edite la visibilidad. Se aplica en la base,
--  así no depende de qué ruta de la API lo cambie.
-- ============================================================

CREATE OR REPLACE FUNCTION tournaments_demo_guard() RETURNS trigger AS $$
BEGIN
  IF NOT NEW.is_demo AND EXISTS (
    SELECT 1 FROM users WHERE id_user = NEW.created_by AND demo_expires_at IS NOT NULL
  ) THEN
    NEW.is_demo := TRUE;
  END IF;
  IF NEW.is_demo THEN
    NEW.visibility := 'private';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tournaments_demo_guard ON tournaments;
CREATE TRIGGER tournaments_demo_guard
  BEFORE INSERT OR UPDATE ON tournaments
  FOR EACH ROW EXECUTE FUNCTION tournaments_demo_guard();

-- Los que ya existen (incluido uno que se haya publicado desde una demo).
UPDATE tournaments SET is_demo = TRUE, visibility = 'private'
 WHERE created_by IN (SELECT id_user FROM users WHERE demo_expires_at IS NOT NULL);
