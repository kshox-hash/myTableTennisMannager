import { Request, Response } from "express";
import { EnrollmentsService } from "./enrollments_service";

export class EnrollmentsController {
  constructor(private service: EnrollmentsService) {}

  subscribe = async (req: Request, res: Response) => {
    try {
      const { id_user, id_tournament, id_category } = req.body;

      // (opcional) valida que existan
      if (!id_user || !id_tournament || !id_category) {
        return res.status(400).json({
          ok: false,
          message: "Faltan campos: id_user, id_tournament, id_category",
        });
      }

      const data = await this.service.subscribe({ id_user, id_tournament, id_category });

      return res.status(201).json({ ok: true, data });
    } catch (error: any) {
      if (error?.message === "CONFLICT_ALREADY_ENROLLED") {
        return res.status(409).json({ ok: false, message: "Ya estás inscrito en esta categoría" });
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
