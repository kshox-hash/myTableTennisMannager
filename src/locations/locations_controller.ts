import type { Request, Response } from "express";
import { LocationsService } from "./locations_service";

export class LocationsController {
  private service = new LocationsService();

  regions = async (_req: Request, res: Response) => {
    try {
      const data = await this.service.listRegions();
      return res.json({ ok: true, data });
    } catch (e: any) {
      return res.status(500).json({
        ok: false,
        error: e?.message ?? "ERROR_REGIONS",
      });
    }
  };

  provinces = async (req: Request, res: Response) => {
    try {
      const { regionCode } = req.query;
      if (!regionCode) {
        return res.status(400).json({ ok: false, error: "regionCode required" });
      }
      const data = await this.service.listProvinces(String(regionCode));
      return res.json({ ok: true, data });
    } catch (e: any) {
      return res.status(500).json({
        ok: false,
        error: e?.message ?? "ERROR_PROVINCES",
      });
    }
  };

  communes = async (req: Request, res: Response) => {
    try {
      const { provinceCode } = req.query;
      if (!provinceCode) {
        return res.status(400).json({ ok: false, error: "provinceCode required" });
      }
      const data = await this.service.listCommunes(String(provinceCode));
      return res.json({ ok: true, data });
    } catch (e: any) {
      return res.status(500).json({
        ok: false,
        error: e?.message ?? "ERROR_COMMUNES",
      });
    }
  };
}
