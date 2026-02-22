import type { Request, Response } from "express";
import { CalendarService } from "./calendar_service";

function isISODate(s: string) {
  // simple: YYYY-MM-DD
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export class CalendarController {
  constructor(private service: CalendarService) {}

  myEvents = async (req: Request, res: Response) => {
    try {
      const id_user = req.user?.id_user;
      if (!id_user) return res.status(401).json({ ok: false, message: "No autorizado" });

      const from = (req.query.from ?? "").toString();
      const to = (req.query.to ?? "").toString();

      if (!isISODate(from) || !isISODate(to)) {
        return res.status(400).json({
          ok: false,
          message: "Parámetros inválidos. Usa ?from=YYYY-MM-DD&to=YYYY-MM-DD",
        });
      }

      const data = await this.service.myEvents(id_user, from, to);
      return res.json({ ok: true, data });
    } catch (e: any) {
      return res.status(500).json({ ok: false, message: e?.message ?? "Error" });
    }
  };
}
