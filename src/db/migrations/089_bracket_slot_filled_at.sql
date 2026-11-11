-- ============================================================
--  089 — Cuándo se llenó cada cupo de la llave adelantada
--
--  Con la llave adelantada, los cupos ("1° GR-7") se llenan solos cuando
--  termina el grupo. Guardar el momento permite mostrarle a la mesa de
--  control qué entró recién ("Terminó GR-7: Juan → Partido 5") y marcarlo
--  como nuevo en la llave. Solo agrega columnas que pueden quedar vacías:
--  no cambia datos existentes.
-- ============================================================

ALTER TABLE bracket_matches ADD COLUMN IF NOT EXISTS player1_filled_at TIMESTAMPTZ;
ALTER TABLE bracket_matches ADD COLUMN IF NOT EXISTS player2_filled_at TIMESTAMPTZ;
