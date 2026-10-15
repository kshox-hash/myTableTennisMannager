-- Colores de los documentos que publica el organizador (fixture y grupos en
-- PDF/imagen): principal (franja/fondo) y acento (horas, detalles). NULL =
-- los colores por defecto. Solo agrega columnas vacías, no toca datos.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS doc_color_primary VARCHAR(7),
  ADD COLUMN IF NOT EXISTS doc_color_accent  VARCHAR(7);
