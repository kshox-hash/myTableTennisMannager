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

      if (result.error === ERRORS.INVALID_ADMIN_SECRET) {
        return res.status(403).json({
          ok: false,
          message: "Código de administrador inválido",
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

      if (result.error === ERRORS.GOOGLE_ONLY_ACCOUNT) {
        return res.status(401).json({
          ok: false,
          message: "Esta cuenta usa Google para iniciar sesión — usa el botón \"Continuar con Google\".",
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

  google = async (req: Request, res: Response) => {
    const result = await this.service.loginWithGoogle(req.body.credential);

    if (!result.ok) {
      return res.status(401).json({
        ok: false,
        message: "No se pudo verificar la cuenta de Google. Inténtalo de nuevo.",
      });
    }

    return res.status(200).json({
      ok: true,
      data: result.data,
    });
  };

  // POST /auth/password/forgot — siempre 200 (no revela si el email existe).
  forgotPassword = async (req: Request, res: Response) => {
    await this.service.forgotPassword(req.body.email);
    return res.json({
      ok: true,
      message: "Si el email tiene una cuenta, te enviamos un código para crear una contraseña nueva.",
    });
  };

  // POST /auth/password/reset — con el código correcto cambia la contraseña y entra.
  resetPassword = async (req: Request, res: Response) => {
    const result = await this.service.resetPassword(req.body);
    if (!result.ok) {
      return res.status(400).json({
        ok: false,
        message:
          result.error === ERRORS.RESET_CODE_EXPIRED
            ? "El código venció. Pide uno nuevo."
            : "El código no es correcto.",
      });
    }
    return res.json({ ok: true, data: result.data });
  };
}