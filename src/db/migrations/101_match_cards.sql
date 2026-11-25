-- ============================================================
--  101 — Tarjetas del partido (reglamento ITTF)
--
--  El árbitro puede mostrar tarjetas por mala conducta: amarilla
--  (advertencia), amarilla + roja (1 y luego 2 puntos al rival) y roja
--  (se avisa al juez árbitro). Se guardan junto al marcador en vivo:
--  [{ "player": 1|2, "kind": "yellow"|"yr1"|"yr2"|"red", "set": 1.. }]
-- ============================================================
ALTER TABLE group_matches   ADD COLUMN IF NOT EXISTS cards JSONB;
ALTER TABLE bracket_matches ADD COLUMN IF NOT EXISTS cards JSONB;
