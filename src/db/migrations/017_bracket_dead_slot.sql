-- ============================================================
--  017 — Slot muerto en llaves con datos incompletos
--  Cuando la llave se genera con grupos sin terminar, puede haber
--  ramas enteras del cuadro sin ningún jugador real. dead_slot marca
--  cuál de los dos cupos (1 o 2) de un partido NUNCA va a llenarse
--  (esa mitad del cuadro no tiene a nadie), para que al registrar el
--  resultado del otro lado el ganador pueda seguir avanzando solo en
--  vez de quedar trabado esperando un rival que no existe.
-- ============================================================

ALTER TABLE bracket_matches
  ADD COLUMN IF NOT EXISTS dead_slot SMALLINT CHECK (dead_slot IN (1, 2));
