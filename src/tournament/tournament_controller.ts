import type { Request, Response } from "express";
import { TournamentService } from "./tournament_service";

export class TournamentController {
  constructor(private service: TournamentService) {}

  createTournament = async (req: Request, res: Response) => {
    try {
      const payload = req.body;

      // ✅ Validación mínima (para evitar que llegue vacío)
      if (!payload?.tournament_name || !payload?.created_by || !payload?.event_date) {
        return res.status(400).json({
          ok: false,
          message: "Faltan campos: tournament_name, created_by, event_date",
        });
      }

      const created = await this.service.createTournament(payload);
      return res.status(201).json({ ok: true, data: created });
    } catch (e: any) {
      return res.status(500).json({ ok: false, message: e?.message ?? "Error" });
    }
  };

  listTournament = async (_req: Request, res: Response) => {
    try {
      const data = await this.service.listTournament();
      return res.json({ ok: true, data });
    } catch (e: any) {
      return res.status(500).json({ ok: false, message: e?.message ?? "Error" });
    }
  };
}
