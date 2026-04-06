import type { Request, Response } from "express";
import { EnrollmentsService } from "./player_enrollment_service";

export class EnrollmentsController {
  constructor(private service: EnrollmentsService) {}

  subscribe = async (req: Request, res: Response) => {
    try {
      const data = await this.service.enRoll(req.body);

      return res.status(201).json({
        ok: true,
        data,
      });
    } catch (error: any) {
      if (error?.message === "CONFLICT_ALREADY_ENROLLED") {
        return res.status(409).json({
          ok: false,
          message: "Ya estás inscrito en esta categoría",
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