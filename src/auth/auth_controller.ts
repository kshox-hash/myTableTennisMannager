import type { Request, Response } from "express";
import { AuthService } from "./auth_service";

export class AuthController {
  constructor(private service: AuthService) {}

  register = async (req: Request, res: Response) => {
    try {
      const data = await this.service.register(req.body);
      return res.status(201).json({ ok: true, data });
    } catch (e: any) {
      const msg = e?.message ?? "Error";
      if (msg === "EMAIL_ALREADY_EXISTS") {
        return res.status(409).json({ ok: false, message: "Email ya existe" });
      }
      if (msg === "ROLE_NOT_FOUND") {
        return res.status(400).json({ ok: false, message: "Rol inválido" });
      }
      if (msg === "ZodError") {
        return res.status(400).json({ ok: false, message: "Datos inválidos" });
      }
      return res.status(400).json({ ok: false, message: msg });
    }
  };

  login = async (req: Request, res: Response) => {
    try {
      const data = await this.service.login(req.body);
      return res.status(200).json({ ok: true, data });
    } catch (e: any) {
      const msg = e?.message ?? "Error";
      if (msg === "INVALID_CREDENTIALS") {
        return res.status(401).json({ ok: false, message: "Credenciales inválidas" });
      }
      return res.status(400).json({ ok: false, message: msg });
    }
  };

  me = async (req: Request, res: Response) => {
    // viene desde authRequired
    return res.json({ ok: true, data: req.user });
  };
}
