import { Router } from "express";
import { asyncHandler } from "../middlewares/wrap_async_middleware";
import { authRequired } from "../middlewares/auth_required_middleware";
import { requireRole } from "../middlewares/require_role_middleware";
import { PlayerRepository } from "./player_repository";
import { dismissCelebration, getCelebrationForCategory, getPendingCelebrations } from "./celebrations";

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

// GET /api/v1/player/tournament/:id_tournament/matches?status=finished&limit=6&offset=0&category=<id>
router.get(
  "/tournament/:id_tournament/matches",
  authRequired,
  requireRole(["admin", "player"]),
  asyncHandler(async (req, res) => {
    const status = req.query.status as "all" | "scheduled" | "live" | "finished" | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
    const id_category = typeof req.query.category === "string" ? req.query.category : undefined;
    // ?stage=group|bracket: solo partidos de grupos o solo de llaves.
    const stage = req.query.stage === "group" || req.query.stage === "bracket" ? req.query.stage : undefined;
    const { rows, total } = await repo.getTournamentMatches(req.params.id_tournament, { status, limit, offset, id_category, stage });
    return res.json({ ok: true, data: { matches: rows, total } });
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
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) || 0 : 0;
    const data = await repo.getPlayerMatchHistory(req.params.id_user, limit, offset);
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

// GET /api/v1/player/me/celebrations — posiciones finales que el jugador
// todavía no vio (ventana de celebración en web y app).
router.get(
  "/me/celebrations",
  authRequired,
  requireRole(["admin", "player"]),
  asyncHandler(async (req, res) => {
    const data = await getPendingCelebrations(req.user!.id_user);
    return res.json({ ok: true, data });
  })
);

// GET /api/v1/player/me/celebrations/category/:id_category — el resumen de
// una categoría terminada aunque ya se haya visto (volver a abrirlo desde
// "Logros" o la notificación "¡Eres campeón!").
router.get(
  "/me/celebrations/category/:id_category",
  authRequired,
  requireRole(["admin", "player"]),
  asyncHandler(async (req, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id_category)) return res.status(400).json({ ok: false, message: "Categoría inválida" });
    const data = await getCelebrationForCategory(req.user!.id_user, req.params.id_category);
    if (!data) return res.status(404).json({ ok: false, message: "No hay resumen para esta categoría" });
    return res.json({ ok: true, data });
  })
);

// POST /api/v1/player/me/celebrations/:id_notification/dismiss — la cerró.
router.post(
  "/me/celebrations/:id_notification/dismiss",
  authRequired,
  requireRole(["admin", "player"]),
  asyncHandler(async (req, res) => {
    const ok = await dismissCelebration(req.user!.id_user, req.params.id_notification);
    if (!ok) return res.status(404).json({ ok: false, message: "Celebración no encontrada" });
    return res.json({ ok: true, data: null });
  })
);

export default router;
