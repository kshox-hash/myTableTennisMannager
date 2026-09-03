import { Router } from "express";
import { asyncHandler } from "../middlewares/wrap_async_middleware";
import { authRequired } from "../middlewares/auth_required_middleware";
import { requireRole } from "../middlewares/require_role_middleware";
import { RankingRepository, type RankingRow } from "./ranking_repository";

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
    ranking_points: r.ranking_points,
    ranking_position: r.ranking_position,
    matches_played: r.matches_played,
    matches_won: r.matches_won,
  };
}

// GET /api/v1/ranking — ranking global (todos los torneos, todas las categorías)
router.get(
  "/",
  authRequired,
  requireRole(["admin", "player"]),
  asyncHandler(async (_req, res) => {
    const data = await repo.getGlobalRanking();
    return res.json({ ok: true, data: data.map(shapeRankingRow) });
  })
);

// GET /api/v1/ranking/me — la posición del propio jugador logueado, para
// la tarjeta "Ranking nacional" del dashboard de inicio. null = todavía
// no jugó ningún partido en la plataforma (no está rankeado todavía).
router.get(
  "/me",
  authRequired,
  requireRole(["admin", "player"]),
  asyncHandler(async (req, res) => {
    const row = await repo.getPlayerRanking(req.user!.id_user);
    return res.json({ ok: true, data: row ? shapeRankingRow(row) : null });
  })
);

// GET /api/v1/ranking/public — mismo ranking, sin login. Vitrina pública,
// igual que /tournament/public/*: reusa el mismo repositorio/criterio de
// orden que la versión autenticada, no duplica la lógica.
router.get(
  "/public",
  asyncHandler(async (req, res) => {
    const limit = req.query.limit ? Math.min(200, Math.max(1, Number(req.query.limit))) : 100;
    const data = await repo.getGlobalRanking(limit);
    return res.json({ ok: true, data: data.map(shapeRankingRow) });
  })
);

export default router;
