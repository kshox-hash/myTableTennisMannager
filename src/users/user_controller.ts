import type { Request, Response } from "express";
import { UserService } from "./user_service";

export class UserController {
  constructor(private service: UserService) {}

  // GET /api/v1/users/me
  me = async (req: Request, res: Response) => {
    const result = await this.service.getProfile(req.user!.id_user);

    if (!result.ok) {
      return res.status(404).json({ ok: false, message: "Usuario no encontrado" });
    }

    return res.json({ ok: true, data: result.data });
  };

  // GET /api/v1/users/me/stats
  stats = async (req: Request, res: Response) => {
    const result = await this.service.getStats(req.user!.id_user);
    if (!result.ok) return res.status(500).json({ ok: false });
    return res.json({ ok: true, data: result.data });
  };

  // GET /api/v1/users/:id_user/profile — ficha pública (cualquier jugador la puede ver)
  publicProfile = async (req: Request, res: Response) => {
    const result = await this.service.getPublicProfile(req.params.id_user);
    if (!result.ok) {
      return res.status(404).json({ ok: false, message: "Usuario no encontrado" });
    }
    return res.json({ ok: true, data: result.data });
  };

  // GET /api/v1/users/:id_user/public-card — ficha mínima, sin login (vitrina pública)
  publicCard = async (req: Request, res: Response) => {
    const result = await this.service.getPublicCard(req.params.id_user);
    if (!result.ok) {
      return res.status(404).json({ ok: false, message: "Usuario no encontrado" });
    }
    return res.json({ ok: true, data: result.data });
  };

  // GET /api/v1/users/admin/search?q= — admin busca jugadores por email/nombre
  adminSearchPlayers = async (req: Request, res: Response) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const result = await this.service.searchPlayers(q);

    if (!result.ok) {
      return res.status(400).json({ ok: false, message: "La búsqueda debe tener al menos 2 caracteres" });
    }

    return res.json({ ok: true, data: result.data });
  };

  // POST /api/v1/users/admin/quick-create — crea un jugador sin cuenta (walk-in) para inscribirlo
  adminQuickCreatePlayer = async (req: Request, res: Response) => {
    const result = await this.service.createQuickPlayer(req.body);
    if (!result.ok) return res.status(500).json({ ok: false });
    return res.status(201).json({ ok: true, data: result.data });
  };

  // PATCH /api/v1/users/me
  updateMe = async (req: Request, res: Response) => {
    const result = await this.service.updateProfile(req.user!.id_user, req.body);
    if (!result.ok) {
      return res.status(404).json({ ok: false, message: "Usuario no encontrado" });
    }
    return res.json({ ok: true, data: result.data });
  };
}
