import { Router } from "express";
import { asyncHandler } from "../../middlewares/wrap_async_middleware";
import { authRequired } from "../../middlewares/auth_required_middleware";
import { requireRole } from "../../middlewares/require_role_middleware";
import { requireTournamentOwnership } from "../../middlewares/require_tournament_ownership_middleware";
import { DoublesRepository } from "./doubles_repository";

const router = Router();
const repo = new DoublesRepository();

// GET /api/v1/tournament/admin/tournaments/:id_tournament/category/:id_category/teams
router.get(
  "/admin/tournaments/:id_tournament/category/:id_category/teams",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(undefined, { allowViewer: true }),
  asyncHandler(async (req, res) => {
    const rows = await repo.listTeams(req.params.id_tournament, req.params.id_category);
    return res.json({ ok: true, data: rows });
  })
);

// POST .../teams  body: { player1_id, player2_id }
router.post(
  "/admin/tournaments/:id_tournament/category/:id_category/teams",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(async (req, res) => {
    const player1_id = (req.body?.player1_id as string | undefined)?.trim();
    const player2_id = (req.body?.player2_id as string | undefined)?.trim();
    if (!player1_id || !player2_id) {
      return res.status(400).json({ ok: false, message: "Faltan player1_id y player2_id" });
    }

    const result = await repo.createTeam({
      id_tournament: req.params.id_tournament,
      id_category: req.params.id_category,
      player1_id,
      player2_id,
    });

    if (!result.ok) {
      const messages: Record<string, string> = {
        CATEGORY_NOT_FOUND: "Categoría no encontrada",
        NOT_DOUBLES: "Esta categoría no es de dobles",
        SAME_PLAYER: "Una pareja necesita dos jugadores distintos",
        PLAYER_NOT_FOUND: "Alguno de los jugadores no existe",
        ALREADY_IN_TEAM: "Uno de los jugadores ya está en otra pareja de esta categoría",
        MIXED_RULE: "En dobles mixtos la pareja tiene que ser un varón y una dama",
        CATEGORY_STARTED: "La categoría ya arrancó — no se pueden armar más parejas",
      };
      return res.status(400).json({ ok: false, message: messages[result.error] ?? result.error });
    }

    return res.status(201).json({ ok: true, data: result.team });
  })
);

// DELETE .../teams/:team_user_id
router.delete(
  "/admin/tournaments/:id_tournament/category/:id_category/teams/:team_user_id",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(async (req, res) => {
    const result = await repo.dissolveTeam({
      id_tournament: req.params.id_tournament,
      id_category: req.params.id_category,
      team_user_id: req.params.team_user_id,
    });
    if (!result.ok) {
      const messages: Record<string, string> = {
        TEAM_NOT_FOUND: "Pareja no encontrada",
        CATEGORY_STARTED: "La categoría ya arrancó — no se puede disolver la pareja",
      };
      return res.status(400).json({ ok: false, message: messages[result.error] ?? result.error });
    }
    return res.json({ ok: true });
  })
);

export default router;
