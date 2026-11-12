import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import type { Pool, PoolClient } from "pg";
import DB from "../db/db_configuration";
import { ActivityLogRepository } from "./activity_log_repository";

/**
 * "Deshacer" de Actividad, como un Ctrl+Z.
 *
 * Antes de cada acción del admin que cambia una categoría (armar grupos,
 * cargar un resultado, generar la llave, mover jugadores...) se saca una foto
 * de cómo estaba cada categoría del campeonato. Si la acción termina bien y
 * cambió alguna, se guarda esa foto como un paso del historial (undo_points).
 *
 * Deshacer un paso devuelve sus categorías exactamente a la foto: grupos,
 * integrantes, tablas, partidos, llave, inscritos y la fase. Lo que se hizo
 * después en esas categorías también se deshace (es volver atrás en el
 * tiempo), y esos pasos salen del historial. Las demás categorías no se tocan.
 */

// Qué acciones guardan un paso, y cómo se llaman en Actividad. La clave es
// "MÉTODO ruta" tal como está declarada en el router (req.route.path). Lo que
// no está acá (marcador en vivo, árbitros, pagos...) no guarda nada.
const LABELS: Record<string, string> = {
  "POST /tournaments/:id_tournament/categories/:id_category/generate": "Armó los grupos",
  "POST /tournaments/:id_tournament/categories/:id_category/regenerate-groups": "Volvió a armar los grupos",
  "POST /tournaments/:id_tournament/categories/:id_category/set-groups-manual": "Armó los grupos a mano",
  "POST /tournaments/:id_tournament/categories/:id_category/groups": "Creó un grupo",
  "POST /groups/:id_group/members": "Cambió los integrantes de un grupo",
  "PATCH /groups/:id_group/qualifiers": "Cambió cuántos clasifican de un grupo",
  "POST /tournaments/:id_tournament/categories/:id_category/swap-players": "Intercambió jugadores entre grupos",
  "PATCH /tournaments/:id_tournament/categories/:id_category/move-player": "Movió un jugador de grupo",
  "POST /tournaments/:id_tournament/categories/:id_category/withdraw-player": "Retiró a un jugador",
  "POST /tournaments/:id_tournament/categories/:id_category/replace-player": "Reemplazó a un jugador",
  "POST /tournaments/:id_tournament/categories/:id_category/confirm-entry": "Confirmó clasificados en la llave",
  "POST /tournaments/:id_tournament/categories/:id_category/swap-bracket-players": "Intercambió jugadores en la llave",
  "POST /matches/:id_match/result": "Cargó un resultado de grupo",
  "POST /matches/:id_match/undo": "Deshizo un resultado de grupo",
  "POST /matches/:id_match/fix-winner": "Cambió el ganador de un partido de grupo",
  "PATCH /tournaments/:id_tournament/categories/:id_category/best-of": "Cambió a cuántos sets se juega",
  "POST /tournaments/:id_tournament/categories/:id_category/generate-bracket": "Generó la llave",
  "POST /tournaments/:id_tournament/categories/:id_category/pre-round-matches": "Armó los partidos previos",
  "POST /bracket-matches/:id_match/players": "Cambió los jugadores de un partido de llave",
  "POST /bracket-matches/:id_match/result": "Cargó un resultado de llave",
  "POST /bracket-matches/:id_match/undo": "Deshizo un resultado de llave",
  "POST /bracket-matches/:id_match/fix-winner": "Cambió el ganador de un partido de llave",
  "PATCH /bracket-matches/:id_match/best-of": "Cambió a cuántos sets se juega un partido",
  "PUT /tournaments/:id_tournament/categories/:id_category/seeds": "Guardó el sembrado",
  "DELETE /tournaments/:id_tournament/categories/:id_category/seeds": "Borró el sembrado",
  "POST /admin/tournaments/:id_tournament/category/:id_category/teams": "Armó una pareja",
  "DELETE /admin/tournaments/:id_tournament/category/:id_category/teams/:team_user_id": "Quitó una pareja",
  "POST /categories/:id_category/config": "Cambió la configuración de la categoría",
  "POST /:id_tournament/categories/:id_category/start-groups": "Empezó la fase de grupos",
  "POST /:id_tournament/categories/:id_category/start-bracket": "Empezó la llave",
  "POST /:id_tournament/categories/:id_category/build-silver": "Armó la llave de Plata",
  "POST /categories/:id_category/finish": "Terminó la categoría",
  "POST /admin/tournaments/:id_tournament/enrollments/remove": "Quitó un inscrito",
  "PATCH /admin/tournaments/:id_tournament/enrollments/player": "Cambió un inscrito",
  "POST /admin/tournaments/:id_tournament/category/:id_category/players": "Agregó un jugador",
  "DELETE /admin/tournaments/:id_tournament/category/:id_category/player/:id_user": "Quitó un jugador",
  "PATCH /tables/assign": "Asignó una mesa",
  "PATCH /tables/release": "Liberó una mesa",
};

/** Cuántos pasos se guardan por campeonato (los más viejos se borran). */
const MAX_POINTS = 60;

type CategoryState = {
  cat: Record<string, unknown>;
  groups: Record<string, unknown>[];
  members: Record<string, unknown>[];
  standings: Record<string, unknown>[];
  gmatches: MatchRow[];
  bmatches: MatchRow[];
  enrollments: Record<string, unknown>[];
  teams: Record<string, unknown>[];
};

type MatchRow = {
  status: string;
  is_bye?: boolean;
  player1_id: string | null;
  player2_id: string | null;
  winner_id: string | null;
  sets_player1: number | null;
  sets_player2: number | null;
};

const STATE_SQL = `
  SELECT c.id_category, jsonb_build_object(
    'cat', to_jsonb(c),
    'groups', COALESCE((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.id_group) FROM category_groups g WHERE g.id_category = c.id_category), '[]'::jsonb),
    'members', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id_group, m.id_user)
                         FROM group_members m JOIN category_groups g ON g.id_group = m.id_group
                         WHERE g.id_category = c.id_category), '[]'::jsonb),
    'standings', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id_group, s.id_user)
                           FROM group_standings s JOIN category_groups g ON g.id_group = s.id_group
                           WHERE g.id_category = c.id_category), '[]'::jsonb),
    'gmatches', COALESCE((SELECT jsonb_agg(to_jsonb(gm) ORDER BY gm.id_match) FROM group_matches gm
                          JOIN category_groups g ON g.id_group = gm.id_group
                          WHERE g.id_category = c.id_category), '[]'::jsonb),
    'bmatches', COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id_match) FROM bracket_matches b WHERE b.id_category = c.id_category), '[]'::jsonb),
    'enrollments', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id_enrollment) FROM enrollments e WHERE e.id_category = c.id_category), '[]'::jsonb),
    'teams', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id_user) FROM doubles_teams t WHERE t.id_category = c.id_category), '[]'::jsonb)
  ) AS state
  FROM tournament_categories c
  WHERE c.id_tournament = $1`;

async function readStates(db: Pool | PoolClient, tournamentId: string): Promise<Map<string, CategoryState>> {
  const res = await db.query<{ id_category: string; state: CategoryState }>(STATE_SQL, [tournamentId]);
  return new Map(res.rows.map((r) => [r.id_category, r.state]));
}

const hashOf = (state: CategoryState) => createHash("md5").update(JSON.stringify(state)).digest("hex");

/** La categoría de Oro y su Plata van siempre juntas: la Plata apunta a los grupos del Oro. */
function withLinked(ids: Set<string>, states: Map<string, CategoryState>): Set<string> {
  const out = new Set(ids);
  for (const [id, s] of states) {
    const silver = s.cat.silver_category_id as string | null;
    if (!silver) continue;
    if (out.has(id)) out.add(silver);
    if (out.has(silver)) out.add(id);
  }
  return out;
}

/**
 * Llamado por requireTournamentOwnership antes de dejar pasar una acción del
 * admin. Si la ruta guarda un paso, saca la foto ahora y, cuando la respuesta
 * sale bien, guarda las categorías que cambiaron. Nunca bloquea la acción:
 * si algo de esto falla, la acción sigue igual (solo no queda para deshacer).
 */
export async function captureUndoPoint(req: Request, res: Response, tournamentId: string): Promise<void> {
  if (req.method === "GET" || !req.route) return;
  const label = LABELS[`${req.method} ${req.route.path}`];
  if (!label || !req.user) return;
  const pool = DB.getPool();
  let before: Map<string, CategoryState>;
  try {
    before = await readStates(pool, tournamentId);
  } catch (err) {
    console.error("[undo] no se pudo sacar la foto:", err);
    return;
  }
  const userId = req.user.id_user;
  res.on("finish", () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    void (async () => {
      const after = await readStates(pool, tournamentId);
      const changed = new Set<string>();
      for (const [id, prev] of before) {
        const now = after.get(id);
        if (now && hashOf(now) !== hashOf(prev)) changed.add(id);
      }
      if (changed.size === 0) return;
      const ids = [...withLinked(changed, before)].filter((id) => before.has(id) && after.has(id));
      const snapshot = Object.fromEntries(ids.map((id) => [id, before.get(id)]));
      const catName = (id: string) => {
        const c = before.get(id)!.cat;
        return `${c.category_type ?? ""} ${c.category_range ?? ""}`.trim();
      };
      const detail = [...changed].map(catName).join(", ");
      await pool.query(
        `INSERT INTO undo_points (id_tournament, id_user, label, detail, category_ids, snapshot)
         VALUES ($1, $2, $3, $4, $5::uuid[], $6::jsonb)`,
        [tournamentId, userId, label, detail || null, ids, JSON.stringify(snapshot)],
      );
      await pool.query(
        `DELETE FROM undo_points WHERE id_tournament = $1 AND id_point NOT IN (
           SELECT id_point FROM undo_points WHERE id_tournament = $1 ORDER BY id_point DESC LIMIT $2)`,
        [tournamentId, MAX_POINTS],
      );
    })().catch((err) => console.error("[undo] no se pudo guardar el paso:", err));
  });
}

export type UndoPointRow = {
  id_point: string;
  id_user: string | null;
  label: string;
  detail: string | null;
  category_ids: string[];
  created_at: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
};

export async function listUndoPoints(tournamentId: string): Promise<UndoPointRow[]> {
  const res = await DB.getPool().query<UndoPointRow>(
    `SELECT p.id_point::text, p.id_user, p.label, p.detail, p.category_ids::text[] AS category_ids, p.created_at::text,
            u.email, u.first_name, u.last_name
     FROM undo_points p
     LEFT JOIN users u ON u.id_user = p.id_user
     WHERE p.id_tournament = $1
     ORDER BY p.id_point DESC`,
    [tournamentId],
  );
  return res.rows;
}

// Lo que cada partido terminado sumó a player_stats (el acumulado de carrera
// de cada jugador, que no cuelga del campeonato). Mismo criterio que al
// cargar el resultado: ganador y perdedor con sus sets; si no se presentó
// ninguno, los dos suman un partido perdido 0-0. Los BYE no suman.
type StatDelta = { played: number; won: number; lost: number; setsWon: number; setsLost: number };

function contributions(matches: MatchRow[]): Map<string, StatDelta> {
  const out = new Map<string, StatDelta>();
  const add = (id: string, d: Partial<StatDelta>) => {
    const cur = out.get(id) ?? { played: 0, won: 0, lost: 0, setsWon: 0, setsLost: 0 };
    for (const k of Object.keys(d) as (keyof StatDelta)[]) cur[k] += d[k] ?? 0;
    out.set(id, cur);
  };
  for (const m of matches) {
    if (m.status !== "played" && m.status !== "walkover") continue;
    if (m.is_bye || !m.player1_id || !m.player2_id) continue;
    const s1 = m.sets_player1 ?? 0;
    const s2 = m.sets_player2 ?? 0;
    if (!m.winner_id) {
      add(m.player1_id, { played: 1, lost: 1 });
      add(m.player2_id, { played: 1, lost: 1 });
      continue;
    }
    const p1Won = m.winner_id === m.player1_id;
    add(m.player1_id, { played: 1, won: p1Won ? 1 : 0, lost: p1Won ? 0 : 1, setsWon: s1, setsLost: s2 });
    add(m.player2_id, { played: 1, won: p1Won ? 0 : 1, lost: p1Won ? 1 : 0, setsWon: s2, setsLost: s1 });
  }
  return out;
}

async function restoreRows(client: PoolClient, table: string, rows: unknown[]): Promise<void> {
  if (rows.length === 0) return;
  await client.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)`, [
    JSON.stringify(rows),
  ]);
}

export type UndoResult =
  | { ok: true; label: string; undoneCount: number }
  | { ok: false; error: "NOT_FOUND" };

/** Vuelve las categorías del paso al estado de antes, y saca del historial ese paso y los posteriores de esas categorías. */
export async function undoToPoint(tournamentId: string, pointId: string, requestedBy: string): Promise<UndoResult> {
  const pool = DB.getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Un deshacer a la vez por campeonato.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`undo:${tournamentId}`]);
    const pRes = await client.query<{ id_point: string; label: string; category_ids: string[]; snapshot: Record<string, CategoryState> }>(
      `SELECT id_point::text, label, category_ids::text[] AS category_ids, snapshot
       FROM undo_points WHERE id_point = $1 AND id_tournament = $2`,
      [pointId, tournamentId],
    );
    const point = pRes.rows[0];
    if (!point) {
      await client.query("ROLLBACK");
      return { ok: false, error: "NOT_FOUND" };
    }

    const current = await readStates(client, tournamentId);
    const statDelta = new Map<string, StatDelta>();
    const addDelta = (id: string, d: StatDelta, sign: 1 | -1) => {
      const cur = statDelta.get(id) ?? { played: 0, won: 0, lost: 0, setsWon: 0, setsLost: 0 };
      for (const k of Object.keys(d) as (keyof StatDelta)[]) cur[k] += sign * d[k];
      statDelta.set(id, cur);
    };

    for (const id of point.category_ids) {
      const target = point.snapshot[id];
      const now = current.get(id);
      if (!target || !now) continue;

      // Pareja (usuario equipo) → sus dos jugadores reales, como al acreditar.
      const teamPlayers = new Map<string, string[]>();
      for (const t of [...now.teams, ...target.teams]) {
        teamPlayers.set(t.id_user as string, [t.id_player_1 as string, t.id_player_2 as string]);
      }
      const realIds = (participant: string) => teamPlayers.get(participant) ?? [participant];
      for (const [p, d] of contributions([...now.gmatches, ...now.bmatches])) for (const r of realIds(p)) addDelta(r, d, -1);
      for (const [p, d] of contributions([...target.gmatches, ...target.bmatches])) for (const r of realIds(p)) addDelta(r, d, 1);

      // Borrar lo de ahora (los grupos arrastran integrantes, tablas y partidos de grupo).
      await client.query(`DELETE FROM bracket_matches WHERE id_category = $1`, [id]);
      await client.query(`DELETE FROM category_groups WHERE id_category = $1`, [id]);
      await client.query(`DELETE FROM enrollments WHERE id_category = $1`, [id]);
      await client.query(`DELETE FROM doubles_teams WHERE id_category = $1`, [id]);
    }

    // Volver a poner lo de la foto. Primero todos los grupos (la Plata apunta a los del Oro).
    for (const id of point.category_ids) {
      const target = point.snapshot[id];
      if (!target || !current.get(id)) continue;
      await restoreRows(client, "category_groups", target.groups);
    }
    for (const id of point.category_ids) {
      const target = point.snapshot[id];
      if (!target || !current.get(id)) continue;
      await restoreRows(client, "group_members", target.members);
      await restoreRows(client, "group_standings", target.standings);
      await restoreRows(client, "group_matches", target.gmatches);
      await restoreRows(client, "bracket_matches", target.bmatches);
      await restoreRows(client, "enrollments", target.enrollments);
      await restoreRows(client, "doubles_teams", target.teams);
      // La categoría misma (fase, configuración...), sin tocar su id ni su campeonato.
      const cols = Object.keys(target.cat).filter((c) => !["id_category", "id_tournament", "created_at"].includes(c));
      if (cols.length > 0) {
        await client.query(
          `UPDATE tournament_categories t SET (${cols.join(", ")}) = (SELECT ${cols.map((c) => `r.${c}`).join(", ")}
             FROM jsonb_populate_record(NULL::tournament_categories, $1::jsonb) r)
           WHERE t.id_category = $2`,
          [JSON.stringify(target.cat), id],
        );
      }
    }

    for (const [userId, d] of statDelta) {
      if (!d.played && !d.won && !d.lost && !d.setsWon && !d.setsLost) continue;
      await client.query(
        `UPDATE player_stats
         SET matches_played = GREATEST(0, matches_played + $2), matches_won = GREATEST(0, matches_won + $3),
             matches_lost = GREATEST(0, matches_lost + $4), sets_won = GREATEST(0, sets_won + $5),
             sets_lost = GREATEST(0, sets_lost + $6), updated_at = NOW()
         WHERE id_user = $1`,
        [userId, d.played, d.won, d.lost, d.setsWon, d.setsLost],
      );
    }

    // Este paso y los posteriores que tocaron estas categorías ya no aplican.
    const del = await client.query(
      `DELETE FROM undo_points
       WHERE id_tournament = $1 AND id_point >= $2 AND category_ids && $3::uuid[]`,
      [tournamentId, point.id_point, point.category_ids],
    );
    await new ActivityLogRepository(pool).record(tournamentId, requestedBy, "change_undone", point.label, client);
    await client.query("COMMIT");
    return { ok: true, label: point.label, undoneCount: del.rowCount ?? 1 };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
