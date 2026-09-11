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

  // GET /api/v1/users/admins — lista de administradores (panel de gestión)
  listAdmins = async (_req: Request, res: Response) => {
    const admins = await this.service.listAdmins();
    return res.json({ ok: true, data: admins });
  };

  // POST /api/v1/users/admins — alta de otro administrador
  createAdmin = async (req: Request, res: Response) => {
    const result = await this.service.createAdmin(req.body);
    if (!result.ok) {
      return res.status(409).json({ ok: false, message: "Ya existe una cuenta con ese email." });
    }
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

  // POST /api/v1/users/me/avatar/upload-url — URL firmada para subir la foto directo a R2
  avatarUploadUrl = async (req: Request, res: Response) => {
    const contentType = typeof req.body?.contentType === "string" ? req.body.contentType : "";
    const result = await this.service.getAvatarUploadUrl(req.user!.id_user, contentType);
    if (!result.ok) {
      if (result.error === "R2_NOT_CONFIGURED") {
        return res.status(503).json({ ok: false, message: "El almacenamiento de imágenes no está configurado." });
      }
      return res.status(400).json({ ok: false, message: "Formato de imagen no permitido (usa JPG, PNG o WEBP)." });
    }
    return res.json({ ok: true, data: result.data });
  };

  // POST /api/v1/users/me/avatar — confirma que la subida a R2 terminó y guarda la URL
  avatarConfirm = async (req: Request, res: Response) => {
    const key = typeof req.body?.key === "string" ? req.body.key : "";
    const result = await this.service.confirmAvatar(req.user!.id_user, key);
    if (!result.ok) {
      if (result.error === "R2_NOT_CONFIGURED") {
        return res.status(503).json({ ok: false, message: "El almacenamiento de imágenes no está configurado." });
      }
      if (result.error === "UPLOAD_NOT_FOUND") {
        return res.status(404).json({ ok: false, message: "No se encontró la imagen subida. Inténtalo de nuevo." });
      }
      if (result.error === "BAD_FILE") {
        return res.status(400).json({ ok: false, message: "La imagen es inválida o muy pesada." });
      }
      return res.status(400).json({ ok: false, message: "Solicitud inválida." });
    }
    return res.json({ ok: true, data: result.data });
  };

  // DELETE /api/v1/users/me/avatar
  avatarRemove = async (req: Request, res: Response) => {
    const result = await this.service.removeAvatar(req.user!.id_user);
    if (!result.ok) {
      if (result.error === "R2_NOT_CONFIGURED") {
        return res.status(503).json({ ok: false, message: "El almacenamiento de imágenes no está configurado." });
      }
      return res.status(404).json({ ok: false, message: "Usuario no encontrado" });
    }
    return res.json({ ok: true, data: result.data });
  };
}
