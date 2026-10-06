import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import DB from "../db/db_configuration";
import { NotificationsRepository } from "../notifications/notifications_repository";

// Arbitraje desde la app: el árbitro de un partido (referee_id, el mismo que
// el organizador ya anota en el panel) puede cargar el marcador en vivo y el
// resultado final desde su celular. Dos formas de quedar como árbitro:
//  A. El organizador lo elige en el panel → le llega "Te toca arbitrar".
//  B. El organizador muestra un QR de un solo uso (2 min) y quien lo escanea
//     queda como árbitro de ese partido.

export type MatchTable = "group_matches" | "bracket_matches";
export const tableOf = (type: "group" | "bracket"): MatchTable => (type === "group" ? "group_matches" : "bracket_matches");

const pool = () => DB.getPool();

/** Solo el árbitro asignado del partido puede anotar (no cualquier usuario). */
export function requireMatchReferee(table: MatchTable) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const r = await pool().query<{ referee_id: string | null }>(
        `SELECT referee_id FROM ${table} WHERE id_match = $1`,
        [req.params.id_match]
      );
      const row = r.rows[0];
      if (!row) return res.status(404).json({ ok: false, message: "Partido no encontrado" });
      if (row.referee_id !== req.user?.id_user) {
        return res.status(403).json({ ok: false, message: "No eres el árbitro de este partido." });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

type MatchInfo = {
  id_match: string;
  match_type: "group" | "bracket";
  id_tournament: string;
  id_category: string;
  tournament_name: string;
  category_display: string;
  player1_name: string | null;
  player2_name: string | null;
  table_number: number | null;
  status: string;
};

const MATCH_INFO_SQL = (table: MatchTable, type: "group" | "bracket") => `
  SELECT m.id_match, '${type}' AS match_type, tc.id_tournament, tc.id_category, t.tournament_name,
         tc.category_type || ' ' || tc.category_range AS category_display,
         COALESCE(NULLIF(TRIM(p1.last_name || ' ' || p1.first_name), ''), p1.email) AS player1_name,
         COALESCE(NULLIF(TRIM(p2.last_name || ' ' || p2.first_name), ''), p2.email) AS player2_name,
         m.table_number, m.status
  FROM ${table} m
  ${type === "group" ? "JOIN category_groups cg ON cg.id_group = m.id_group JOIN tournament_categories tc ON tc.id_category = cg.id_category" : "JOIN tournament_categories tc ON tc.id_category = m.id_category"}
  JOIN tournaments t ON t.id_tournament = tc.id_tournament
  LEFT JOIN users p1 ON p1.id_user = m.player1_id
  LEFT JOIN users p2 ON p2.id_user = m.player2_id`;

async function matchInfo(type: "group" | "bracket", idMatch: string): Promise<MatchInfo | null> {
  const r = await pool().query<MatchInfo>(`${MATCH_INFO_SQL(tableOf(type), type)} WHERE m.id_match = $1`, [idMatch]);
  return r.rows[0] ?? null;
}

/** Aviso al jugador que quedó como árbitro (push + campana). Nunca lanza. */
export async function notifyRefereeAssigned(type: "group" | "bracket", idMatch: string, refereeId: string | null) {
  if (!refereeId) return;
  try {
    const m = await matchInfo(type, idMatch);
    if (!m || m.status === "played" || m.status === "walkover") return;
    const mesa = m.table_number ? ` en la mesa ${m.table_number}` : "";
    await new NotificationsRepository(pool()).create({
      idUser: refereeId,
      type: "referee_assigned",
      title: "Te toca arbitrar",
      message: `${m.player1_name ?? "Por definir"} vs ${m.player2_name ?? "Por definir"}${mesa} · ${m.category_display} (${m.tournament_name}). Anota el marcador desde la app.`,
      idTournament: m.id_tournament,
      idCategory: m.id_category,
      idMatch: m.id_match,
      matchType: type,
    });
  } catch (err) {
    console.error("[notifyRefereeAssigned]", err);
  }
}

/** Partidos sin terminar donde el usuario es árbitro (para "Tienes un partido para arbitrar"). */
export async function myRefereeMatches(idUser: string): Promise<MatchInfo[]> {
  const where = `WHERE m.referee_id = $1 AND m.status NOT IN ('played', 'walkover', 'bye')
                   AND m.player1_id IS NOT NULL AND m.player2_id IS NOT NULL`;
  const [g, b] = await Promise.all([
    pool().query<MatchInfo>(`${MATCH_INFO_SQL("group_matches", "group")} ${where}`, [idUser]),
    pool().query<MatchInfo>(`${MATCH_INFO_SQL("bracket_matches", "bracket")} ${where}`, [idUser]),
  ]);
  return [...g.rows, ...b.rows].sort((a, c) => (a.table_number ?? 999) - (c.table_number ?? 999));
}

const TOKEN_TTL_MS = 2 * 60 * 1000;

/** El organizador pide un QR para un partido: token aleatorio, 2 min, un solo uso. */
export async function createRefereeToken(type: "group" | "bracket", idMatch: string, createdBy: string) {
  const token = crypto.randomBytes(18).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  // Un QR nuevo invalida los anteriores sin usar del mismo partido.
  await pool().query(
    `UPDATE referee_tokens SET expires_at = NOW() WHERE match_type = $1 AND id_match = $2 AND used_at IS NULL`,
    [type, idMatch]
  );
  await pool().query(
    `INSERT INTO referee_tokens (token, match_type, id_match, created_by, expires_at) VALUES ($1, $2, $3, $4, $5)`,
    [token, type, idMatch, createdBy, expiresAt]
  );
  return { token, expires_at: expiresAt.toISOString(), qr: `myttm-ref:${token}` };
}

export type ClaimResult =
  | { ok: true; match_type: "group" | "bracket"; id_match: string }
  | { ok: false; status: number; message: string };

/** Quien escanea el QR queda como árbitro (si el código sigue vigente y sin usar). */
export async function claimRefereeToken(rawToken: string, idUser: string): Promise<ClaimResult> {
  const token = rawToken.replace(/^myttm-ref:/, "").trim();
  if (!token) return { ok: false, status: 400, message: "Código inválido." };
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const r = await client.query<{ match_type: "group" | "bracket"; id_match: string; expires_at: Date; used_at: Date | null }>(
      `SELECT match_type, id_match, expires_at, used_at FROM referee_tokens WHERE token = $1 FOR UPDATE`,
      [token]
    );
    const t = r.rows[0];
    if (!t) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, message: "Este código no es válido." };
    }
    if (t.used_at) {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, message: "Este código ya se usó. Pídele al organizador uno nuevo." };
    }
    if (new Date(t.expires_at).getTime() < Date.now()) {
      await client.query("ROLLBACK");
      return { ok: false, status: 410, message: "Este código venció. Pídele al organizador uno nuevo." };
    }
    const table = tableOf(t.match_type);
    const upd = await client.query(
      `UPDATE ${table} SET referee_id = $1
        WHERE id_match = $2 AND status NOT IN ('played', 'walkover', 'bye')
          AND player1_id IS NOT NULL AND player2_id IS NOT NULL
          AND player1_id <> $1 AND player2_id <> $1
        RETURNING id_match`,
      [idUser, t.id_match]
    );
    if ((upd.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      const own = await client.query(`SELECT 1 FROM ${table} WHERE id_match = $1 AND $2 IN (player1_id, player2_id)`, [t.id_match, idUser]);
      if ((own.rowCount ?? 0) > 0) return { ok: false, status: 409, message: "No puedes arbitrar tu propio partido." };
      return { ok: false, status: 409, message: "Este partido ya terminó o todavía no tiene a los dos jugadores." };
    }
    await client.query(`UPDATE referee_tokens SET used_at = NOW(), used_by = $1 WHERE token = $2`, [idUser, token]);
    await client.query("COMMIT");
    return { ok: true, match_type: t.match_type, id_match: t.id_match };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Árbitro actual de un partido (para avisar solo si cambió). */
export async function currentReferee(type: "group" | "bracket", idMatch: string): Promise<string | null> {
  const r = await pool().query<{ referee_id: string | null }>(`SELECT referee_id FROM ${tableOf(type)} WHERE id_match = $1`, [idMatch]);
  return r.rows[0]?.referee_id ?? null;
}
