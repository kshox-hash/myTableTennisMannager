-- ============================================================
--  071 — Celebración de la posición final
--
--  Al terminar una categoría, cada jugador ya recibe un aviso
--  "final_position". Ahora además se le muestra una ventana de
--  celebración (web y app) con su lugar y el podio, apenas entra.
--  celebrated_at = cuándo la cerró (en cualquiera de las dos: así no
--  vuelve a aparecer en la otra).
--
--  Los avisos que ya existían se marcan como celebrados: solo los
--  campeonatos que terminen desde ahora disparan la ventana.
-- ============================================================

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS celebrated_at TIMESTAMPTZ;

UPDATE notifications SET celebrated_at = created_at
WHERE type = 'final_position' AND celebrated_at IS NULL;
