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
  asyncHandler(async (_req, res) => {
    if (!GLOBAL_RANKING_ENABLED) return res.json({ ok: true, data: [] });
    const data = await repo.getGlobalRanking();
    return res.json({ ok: true, data: data.map(shapeRankingRow) });
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
router.get(
  "/mine-as-organizer",
  authRequired,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const data = await repo.getOrganizerRanking(req.user!.id_user);
    return res.json({ ok: true, data: data.map(shapeRankingRow) });
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
    const data = await repo.getGlobalRanking(limit);
    return res.json({ ok: true, data: data.map(shapeRankingRow) });
  })
);

export default router;
