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

  // Loguear siempre el error real del lado del servidor (con stack) para
  // poder diagnosticar — lo que cambia según entorno es solo qué tanto de
  // eso se le devuelve al cliente.
  console.error(err);

  // Antes esto devolvía err.message tal cual en CUALQUIER entorno,
  // incluida producción — un error de Postgres sin capturar (ej. una
  // constraint violation) filtraba nombres reales de tabla/columna al
  // cliente. No hay ningún NODE_ENV seteado hoy en Render, así que el
  // default seguro es "no development" (genérico) salvo que se declare
  // explícitamente development — nunca al revés.
  const isDev = process.env.NODE_ENV === "development";
  const message =
    isDev && err instanceof Error && err.message
      ? err.message
      : "Ocurrió un error interno. Intentá de nuevo más tarde.";

  return res.status(500).json({
    ok: false,
    message,
  });
}