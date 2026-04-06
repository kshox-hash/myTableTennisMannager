import type { Request, Response } from "express";
import { AuthService } from "./auth_service";
import { ERRORS } from "./dto/auth_dto";

export class AuthController {
  constructor(private service: AuthService) {}

  signUp = async (req: Request, res: Response) => {
    const result = await this.service.register(req.body);

    if (!result.ok) {
      if (result.error === ERRORS.EMAIL_ALREADY_EXISTS) {
        return res.status(409).json({
          ok: false,
          message: "Email ya existe",
        });
      }

      return res.status(400).json({
        ok: false,
        message: result.error,
      });
    }

    return res.status(201).json({
      ok: true,
      data: result.data,
    });
  };

  signIn = async (req: Request, res: Response) => {
    const result = await this.service.login(req.body);

    if (!result.ok) {
      if (result.error === ERRORS.INVALID_CREDENTIALS) {
        return res.status(401).json({
          ok: false,
          message: "Credenciales inválidas",
        });
      }

      return res.status(400).json({
        ok: false,
        message: result.error,
      });
    }

    return res.status(200).json({
      ok: true,
      data: result.data,
    });
  };
}