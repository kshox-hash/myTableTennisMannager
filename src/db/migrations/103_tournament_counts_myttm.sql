-- ============================================================
--  103 — Ranking MyTTM: solo campeonatos aprobados
-- ============================================================
-- El ranking general de la plataforma (pestaña Ranking de la app y la web)
-- sumaba TODOS los campeonatos puntuables, incluidos los que una asociación
-- arma para su propio ranking: en la práctica era el ranking de esa
-- asociación con otro nombre. Ahora solo suman los que el súper usuario
-- aprueba (counts_myttm = true). Los rankings de cada organizador no
-- cambian, y el sembrado de grupos/llave tampoco.
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS counts_myttm BOOLEAN NOT NULL DEFAULT FALSE;
