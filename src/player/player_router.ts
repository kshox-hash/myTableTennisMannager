import { Router } from "express";
import { asyncHandler } from "../middlewares/wrap_async_middleware";
import { authRequired } from "../middlewares/auth_required_middleware";
import { requireRole } from "../middlewares/require_role_middleware";
import { PlayerRepository } from "./player_repository";

const router = Router();
const repo   = new PlayerRepository();

// GET /api/v1/player/dashboard
router.get(
  "/dashboard",
  authRequired,
  requireRole(["admin", "player"]),
  asyncHandler(async (req, res) => {
    const id_user = (req as any).user?.id_user;
    if (!id_user) return res.status(401).json({ ok: false, message: "Sin usuario en token" });
    const data = await repo.getDashboard(id_user);
    return res.json({ ok: true, data });
  })
);

// GET /api/v1/player/my-enrollments
router.get(
  "/my-enrollments",
  authRequired,
  requireRole(["admin", "player"]),
  asyncHandler(async (req, res) => {
    const id_user = (req as any).user?.id_user;
    const data = await repo.getMyEnrollments(id_user);
    return res.json({ ok: true, data });
  })
);

// GET /api/v1/player/tournament/:id_tournament/category/:id_category
router.get(
  "/tournament/:id_tournament/category/:id_category",
  authRequired,
  requireRole(["admin", "player"]),
  asyncHandler(async (req, res) => {
    const id_user = (req as any).user?.id_user;
    const data = await repo.getCategoryView(
      id_user,
      req.params.id_tournament,
      req.params.id_category
    );
    return res.json({ ok: true, data });
  })
);

// GET /api/v1/player/tournament/:id_tournament/category/:id_category/participants
router.get(
  "/tournament/:id_tournament/category/:id_category/participants",
  authRequired,
  requireRole(["admin", "player"]),
  asyncHandler(async (req, res) => {
    const data = await repo.getCategoryParticipants(
      req.params.id_tournament,
      req.params.id_category
    );
    return res.json({ ok: true, data });
  })
);

// GET /api/v1/player/tournament/:id_tournament/category/:id_category/standings
router.get(
  "/tournament/:id_tournament/category/:id_category/standings",
  authRequired,
  requireRole(["admin", "player"]),
  asyncHandler(async (req, res) => {
    const data = await repo.getCategoryStandings(req.params.id_tournament, req.params.id_category);
    return res.json({ ok: true, data });
  })
);

// GET /api/v1/player/tournament/:id_tournament/participants — todos los
// inscritos del torneo, de todas las categorías juntas.
router.get(
  "/tournament/:id_tournament/participants",
  authRequired,
  requireRole(["admin", "player"]),
  asyncHandler(async (req, res) => {
    const data = await repo.getTournamentParticipants(req.params.id_tournament);
    return res.json({ ok: true, data });
  })
);

// GET /api/v1/player/tournament/:id_tournament/matches?status=finished&limit=6
router.get(
  "/tournament/:id_tournament/matches",
  authRequired,
  requireRole(["admin", "player"]),
  asyncHandler(async (req, res) => {
    const status = req.query.status as "all" | "scheduled" | "live" | "finished" | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const data = await repo.getTournamentMatches(req.params.id_tournament, { status, limit });
    return res.json({ ok: true, data });
  })
);

// GET /api/v1/player/match/:match_type/:id_match — detalle de un partido
router.get(
  "/match/:match_type/:id_match",
  authRequired,
  requireRole(["admin", "player"]),
  asyncHandler(async (req, res) => {
    const matchType = req.params.match_type;
    if (matchType !== "group" && matchType !== "bracket") {
      return res.status(400).json({ ok: false, message: "match_type inválido" });
    }
    const data = await repo.getMatchDetail(matchType, req.params.id_match);
    if (!data) return res.status(404).json({ ok: false, message: "Partido no encontrado" });
    return res.json({ ok: true, data });
  })
);

// GET /api/v1/player/user/:id_user/matches — historial público de un jugador
router.get(
  "/user/:id_user/matches",
  authRequired,
  requireRole(["admin", "player"]),
  asyncHandler(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const data = await repo.getPlayerMatchHistory(req.params.id_user, limit);
    return res.json({ ok: true, data });
  })
);

// GET /api/v1/player/user/:id_user/achievements — podio (top 3) de un
// jugador en categorías ya finalizadas (propio o público, mismo criterio
// que el historial de partidos de arriba).
router.get(
  "/user/:id_user/achievements",
  authRequired,
  requireRole(["admin", "player"]),
  asyncHandler(async (req, res) => {
    const data = await repo.getPlayerAchievements(req.params.id_user);
    return res.json({ ok: true, data });
  })
);

export default router;
