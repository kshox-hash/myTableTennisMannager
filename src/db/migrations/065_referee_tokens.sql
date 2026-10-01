-- ============================================================
--  065 — Códigos QR de árbitro (un solo uso)
-- ============================================================
-- El organizador genera en el panel un QR para un partido; quien lo escanee
-- con la app queda como árbitro de ese partido y puede anotar el marcador.
-- Dura 2 minutos y sirve una sola vez (una foto del QR no sirve después).
CREATE TABLE IF NOT EXISTS referee_tokens (
  token       TEXT PRIMARY KEY,
  match_type  TEXT NOT NULL CHECK (match_type IN ('group', 'bracket')),
  id_match    UUID NOT NULL,
  created_by  UUID NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  used_by     UUID REFERENCES users(id_user) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_referee_tokens_match ON referee_tokens (match_type, id_match);
