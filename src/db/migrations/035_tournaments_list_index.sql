-- Soporta el ORDER BY event_date/created_at que usan tanto el listado
-- público de torneos como el listado de torneos del jugador (para
-- inscribirse) — sin esto, cada página pedida obliga a Postgres a traer
-- y ordenar la tabla tournaments entera antes de aplicar el LIMIT. A esta
-- escala (miles de torneos) el JOIN que arreglamos en el mismo pase era
-- el costo dominante, pero este índice sigue haciendo falta para que el
-- ORDER BY se resuelva por índice a medida que la tabla crezca más.
CREATE INDEX IF NOT EXISTS idx_tournaments_event_date ON tournaments (event_date, created_at);
