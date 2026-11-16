import { Router } from "express";
import { asyncHandler } from "../middlewares/wrap_async_middleware";
import { authRequired } from "../middlewares/auth_required_middleware";
import { requireRole } from "../middlewares/require_role_middleware";
import { createPracticeTournament, deletePracticeTournament, findPracticeTournament } from "./demo_seeder";

// /api/v1/practice — campeonato de práctica del recorrido guiado (ver
// createPracticeTournament en demo_seeder.ts). Solo organizadores.
const router = Router();
router.use(authRequired, requireRole("admin"));

// GET — el campeonato de práctica de la cuenta, si tiene.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    return res.json({ ok: true, data: { id_tournament: await findPracticeTournament(req.user!.id_user) } });
  })
);

// POST — lo arma (unos segundos); si ya existe, devuelve ese.
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const id = await createPracticeTournament(req.user!.id_user);
    return res.status(201).json({ ok: true, data: { id_tournament: id } });
  })
);

// DELETE — lo borra con sus jugadores ficticios.
router.delete(
  "/",
  asyncHandler(async (req, res) => {
    await deletePracticeTournament(req.user!.id_user);
    return res.json({ ok: true });
  })
);

export default router;
