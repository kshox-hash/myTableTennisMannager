import type { Request, Response } from "express";
import { EnrollmentsService } from "./player_enrollment_service";

export class EnrollmentsController {
  constructor(private service: EnrollmentsService) {}

  subscribe = async (req: Request, res: Response) => {
    try {
      // id_user viene del token (authRequired garantiza que req.user existe)
      const data = await this.service.enRoll(req.user!.id_user, req.body);

      return res.status(201).json({ ok: true, data });
    } catch (error: any) {
      if (error?.message === "CONFLICT_ALREADY_ENROLLED") {
        return res.status(409).json({
          ok: false,
          message: "Ya estás inscrito en esta categoría",
        });
      }

      if (error?.message === "QUOTA_EXCEEDED") {
        return res.status(409).json({
          ok: false,
          message: "Esta categoría ya no tiene cupos disponibles",
        });
      }

      if (error?.message === "TOURNAMENT_CANCELLED") {
        return res.status(409).json({
          ok: false,
          message: "Este campeonato fue cancelado por el organizador",
        });
      }

      if (error?.message === "CATEGORY_NOT_OPEN") {
        return res.status(409).json({
          ok: false,
          message: "Esta categoría no está abierta para inscripciones",
        });
      }

      if (error?.message === "CATEGORY_ALREADY_STARTED") {
        return res.status(409).json({
          ok: false,
          message: "Esta categoría ya arrancó (grupos o llave en curso): no se puede inscribir",
        });
      }

      if (error?.message === "GENDER_REQUIRED") {
        return res.status(409).json({
          ok: false,
          message: "Completá tu género en tu perfil para poder inscribirte en esta categoría",
        });
      }

      if (error?.message === "GENDER_MISMATCH") {
        return res.status(409).json({
          ok: false,
          message: "Esta categoría no es de tu género",
        });
      }

      if (error?.message === "INVALID_TOURNAMENT_OR_CATEGORY") {
        return res.status(400).json({
          ok: false,
          message: "Categoría no pertenece al torneo (o IDs inválidos)",
        });
      }

      return res.status(500).json({
        ok: false,
        message: error?.message || "Error interno",
      });
    }
  };
}
