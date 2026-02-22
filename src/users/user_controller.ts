import type { Request, Response } from "express";
import { UserService } from "./user_service";

export class UserController {
  constructor(private service: UserService) {}

  me = async (req: Request, res: Response) => {
    try {
      const id_user = req.user?.id_user;
      if (!id_user) return res.status(401).json({ ok: false, message: "No autorizado" });

      const data = await this.service.me(id_user);
      return res.json({ ok: true, data });
    } catch (e: any) {
      const msg = e?.message ?? "Error";
      if (msg === "USER_NOT_FOUND") return res.status(404).json({ ok: false, message: "Usuario no existe" });
      return res.status(400).json({ ok: false, message: msg });
    }
  };
}
