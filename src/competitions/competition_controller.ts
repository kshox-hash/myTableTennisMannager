// src/controllers/competition_controller.ts
// ✅ Controller sin auth (por ahora)
// - createdBy es opcional: lo puedes mandar en body si quieres validar admin por DB
// - si no lo mandas, no valida admin (solo para dev)

import type { Request, Response } from "express";
import { CompetitionService } from "../competitions/competition_service";

export class CompetitionController {
  private service = new CompetitionService();

  // POST /api/tournaments/:tournamentId/categories/:categoryId/generate-groups
  generateGroupsAndMatches = async (req: Request, res: Response) => {
    try {
      const { tournamentId, categoryId } = req.params;

      // Por ahora: lo puedes mandar en body para validar admin por DB (opcional)
      const createdBy = req.body?.created_by as string | undefined;

      const result = await this.service.generateGroupsAndMatches({
        tournamentId,
        categoryId,
        createdBy,
      });

      return res.status(201).json(result);
    } catch (err: any) {
      const msg = err?.message ?? "ERROR";

      const status =
        msg === "USER_NOT_ADMIN" ? 403 :
        msg === "CATEGORY_NOT_FOUND" ? 404 :
        msg === "GROUPS_ALREADY_GENERATED" ? 409 :
        msg === "NOT_ENOUGH_PLAYERS" ? 400 :
        msg === "CATEGORY_NOT_OPEN" ? 400 :
        400;

      return res.status(status).json({ error: msg });
    }
  };
}
