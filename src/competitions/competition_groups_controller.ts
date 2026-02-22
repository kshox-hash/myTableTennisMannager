import type { Request, Response } from "express";
import { CompetitionGroupsService } from "./competition_groups_service";

export class CompetitionGroupsController {
  private service = new CompetitionGroupsService();

  getGroups = async (req: Request, res: Response) => {
    try {
      const { tournamentId, categoryId } = req.params;
      const data = await this.service.getGroups(tournamentId, categoryId);
      return res.status(200).json(data);
    } catch (err: any) {
      const msg = err?.message ?? "ERROR";
      const status = msg === "COMPETITION_NOT_FOUND" ? 404 : 400;
      return res.status(status).json({ ok: false, error: msg });
    }
  };
}
