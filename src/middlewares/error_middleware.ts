import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      message: "Datos inválidos",
      errors: err.flatten(),
    });
  }

  if (err instanceof Error) {
    return res.status(500).json({
      ok: false,
      message: err.message || "Internal Server Error",
    });
  }

  return res.status(500).json({
    ok: false,
    message: "Internal Server Error",
  });
}