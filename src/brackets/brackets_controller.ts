// src/brackets/brackets_controller.ts
import type { Request, Response } from "express";
import { BracketService } from "./brackets_service";

export class BracketController {
  private service = new BracketService();

  generateBracket = async (req: Request, res: Response) => {
    try {
      const { tournamentId, categoryId } = req.params;
      const createdBy = req.body?.created_by as string | undefined;

      if (!createdBy) return res.status(400).json({ ok: false, error: "created_by is required" });

      const result = await this.service.generateBracket({ tournamentId, categoryId, createdBy });
      return res.status(201).json(result);
    } catch (err: any) {
      const msg = err?.message ?? "ERROR_GENERATING_BRACKET";
      const status =
        msg === "USER_NOT_ADMIN" ? 403 :
        msg === "COMPETITION_NOT_FOUND" ? 404 :
        msg === "BRACKET_ALREADY_GENERATED" ? 409 :
        msg === "COMPETITION_NOT_READY_FOR_BRACKET" ? 400 :
        msg === "NOT_ENOUGH_QUALIFIED_PLAYERS" ? 400 :
        400;
      return res.status(status).json({ ok: false, error: msg });
    }
  };

  // POST /api/brackets/:bracketId/matches/:matchId/result
  reportResult = async (req: Request, res: Response) => {
    try {
      const { bracketId, matchId } = req.params;
      const { winner_id, sets_p1, sets_p2 } = req.body;

      if (!winner_id) return res.status(400).json({ ok: false, error: "winner_id is required" });

      const result = await this.service.reportBracketResult({
        bracketId,
        matchId,
        winnerId: winner_id,
        setsP1: Number(sets_p1 ?? 0),
        setsP2: Number(sets_p2 ?? 0),
      });

      return res.status(200).json(result);
    } catch (err: any) {
      const msg = err?.message ?? "ERROR_REPORTING_RESULT";
      const status =
        msg === "MATCH_NOT_FOUND" ? 404 :
        msg === "MATCH_ALREADY_PLAYED" ? 409 :
        msg === "WINNER_NOT_IN_MATCH" ? 400 :
        msg === "MATCH_IS_BYE" ? 400 :
        400;
      return res.status(status).json({ ok: false, error: msg });
    }
  };
}
