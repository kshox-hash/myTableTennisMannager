-- Rehacer: al deshacer se guarda cómo estaba la categoría justo antes, como
-- un paso más ("Deshizo «…»", kind = 'undo'). Deshacer ese paso es rehacer.
-- Los pasos que quedaron atrás por un deshacer no se borran: se esconden
-- (hidden_by = el paso "Deshizo") y vuelven a aparecer si se rehace.
ALTER TABLE undo_points ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'action';
ALTER TABLE undo_points ADD COLUMN IF NOT EXISTS hidden_by BIGINT;
