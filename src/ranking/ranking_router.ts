import { Router } from "express";
import { asyncHandler } from "../middlewares/wrap_async_middleware";
import { authRequired } from "../middlewares/auth_required_middleware";
import { requireRole } from "../middlewares/require_role_middleware";
import { RankingRepository, type RankingRow, GLOBAL_RANKING_ENABLED } from "./ranking_repository";

const router = Router();
const repo = new RankingRepository();

// El repo trae email (lo necesita internamente para JOIN con users), pero
// nunca debería salir en la respuesta — ni en la versión pública ni en la
// autenticada, otro jugador no tiene por qué ver el email de nadie más.
// Encontrado en la auditoría de seguridad: se estaba devolviendo la fila
// cruda del repo tal cual, así que cualquiera podía levantar el email de
// TODA la base de jugadores rankeados desde un endpoint sin login.
function shapeRankingRow(r: RankingRow) {
  return {
    id_user: r.id_user,
    first_name: r.first_name,
    last_name: r.last_name,
    club_name: r.club_name,
    avatar_url: r.avatar_url,
    ranking_points: r.ranking_points,
    ranking_position: r.ranking_position,
    matches_played: r.matches_played,
    matches_won: r.matches_won,
  };
}

// GET /api/v1/ranking — ranking global (todos los torneos, todas las categorías)
// Desactivado (ver GLOBAL_RANKING_ENABLED en ranking_repository.ts): responde
// vacío en vez de consultar player_stats, que ya no se sigue actualizando.
router.get(
  "/",
  authRequired,
  requireRole(["admin", "player"]),
  asyncHandler(async (req, res) => {
    if (!GLOBAL_RANKING_ENABLED) return res.json({ ok: true, data: [] });
    // ?organizer=<id>: el ranking de ese organizador (solo sus campeonatos).
    const data = await repo.getScopedRanking(organizerParam(req.query.organizer), 200, copaParam(req.query.copa));
    return res.json({ ok: true, data: data.map(shapeRankingRow) });
  })
);

// ?copa=oro|plata: solo esa copa; sin el parámetro, el General.
function copaParam(v: unknown): "oro" | "plata" | "general" {
  return v === "oro" || v === "plata" ? v : "general";
}

// Id de organizador del query string (o null = ranking general). Un valor
// que no es un uuid se ignora en vez de romper la consulta.
function organizerParam(v: unknown): string | null {
  return typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

// GET /api/v1/ranking/scopes — los rankings que el jugador puede elegir:
// el general y uno por cada organizador en cuyos campeonatos puntuables
// (últimos 12 meses) tiene resultado.
router.get(
  "/scopes",
  authRequired,
  asyncHandler(async (req, res) => {
    const organizers = await repo.getPlayerScopes(req.user!.id_user);
    return res.json({ ok: true, data: organizers });
  })
);

// GET /api/v1/ranking/tournaments?organizer= — campeonatos que forman ese
// ranking ("Basado en N campeonatos…").
router.get(
  "/tournaments",
  authRequired,
  asyncHandler(async (req, res) => {
    const data = await repo.getScopeTournaments(organizerParam(req.query.organizer), copaParam(req.query.copa));
    return res.json({ ok: true, data });
  })
);

// GET /api/v1/ranking/players/:id_user/breakdown?organizer= — de qué
// campeonatos salen los puntos de un jugador y en qué ronda quedó.
router.get(
  "/players/:id_user/breakdown",
  authRequired,
  asyncHandler(async (req, res) => {
    const id = req.params.id_user;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ ok: false, message: "Jugador inválido" });
    const data = await repo.getPlayerBreakdown(id, organizerParam(req.query.organizer), copaParam(req.query.copa));
    return res.json({ ok: true, data });
  })
);

// GET /api/v1/ranking/me — la posición del propio jugador logueado. Ya no se
// usa desde ninguna pantalla (la tarjeta "Ranking nacional" del dashboard se
// sacó junto con el resto del ranking general) — desactivado igual que arriba.
router.get(
  "/me",
  authRequired,
  requireRole(["admin", "player"]),
  asyncHandler(async (req, res) => {
    if (!GLOBAL_RANKING_ENABLED) return res.json({ ok: true, data: null });
    const row = await repo.getPlayerRanking(req.user!.id_user);
    return res.json({ ok: true, data: row ? shapeRankingRow(row) : null });
  })
);

// GET /api/v1/ranking/mine-as-organizer — ranking privado de ESTE admin:
// solo los torneos que él creó, no el ranking global de la plataforma.
// Nadie más puede pedir el de otro admin (no recibe id por parámetro,
// siempre usa el del token) — es privado, no una vitrina pública.
// ?ranking=<id>: uno de SUS rankings (sin el parámetro, el más reciente).
router.get(
  "/mine-as-organizer",
  authRequired,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const me = req.user!.id_user;
    const wanted = organizerParam(req.query.ranking);
    if (wanted) {
      const r = await repo.getRanking(wanted);
      if (!r || r.id_owner !== me) return res.status(404).json({ ok: false, message: "Ranking no encontrado" });
    }
    const data = await repo.getOrganizerRanking(me, 200, copaParam(req.query.copa), wanted);
    return res.json({ ok: true, data: data.map(shapeRankingRow) });
  })
);

// GET /api/v1/ranking/mine/rankings — los rankings de este admin (cada uno
// junta los campeonatos que el admin le asignó), el más reciente primero.
router.get(
  "/mine/rankings",
  authRequired,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const data = await repo.listOwnerRankings(req.user!.id_user);
    return res.json({ ok: true, data });
  })
);

// GET /api/v1/ranking/mine/rankings/:id/history — de dónde sale el resultado
// de uno de SUS rankings: campeonatos sumados/sacados y puntos de cada uno.
router.get(
  "/mine/rankings/:id/history",
  authRequired,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const r = await repo.getRanking(String(req.params.id));
    if (!r || r.id_owner !== req.user!.id_user) return res.status(404).json({ ok: false, message: "Ranking no encontrado" });
    const data = await repo.getRankingHistory(r.id_ranking, copaParam(req.query.copa));
    return res.json({ ok: true, data });
  })
);

// GET /api/v1/ranking/public — mismo ranking, sin login. Vitrina pública,
// igual que /tournament/public/*: reusa el mismo repositorio/criterio de
// orden que la versión autenticada, no duplica la lógica. Desactivado igual
// que arriba.
router.get(
  "/public",
  asyncHandler(async (req, res) => {
    if (!GLOBAL_RANKING_ENABLED) return res.json({ ok: true, data: [] });
    const limit = req.query.limit ? Math.min(200, Math.max(1, Number(req.query.limit))) : 100;
    const data = await repo.getScopedRanking(null, limit, copaParam(req.query.copa));
    return res.json({ ok: true, data: data.map(shapeRankingRow) });
  })
);

export default router;
