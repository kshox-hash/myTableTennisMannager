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

  // Errores del CLIENTE que antes caían como 500 "error interno" (y
  // ensuciaban el log con stacks que no eran bugs): un id que no es UUID
  // en la URL (Postgres 22P02 al castear, ej. /public/tournaments/abc) y un
  // body que no es JSON válido (express.json → entity.parse.failed).
  const e = err as { code?: string; type?: string; status?: number } | null;
  if (e?.code === "22P02") {
    return res.status(400).json({ ok: false, message: "Identificador inválido" });
  }
  if (e?.type === "entity.parse.failed") {
    return res.status(400).json({ ok: false, message: "El cuerpo del pedido no es JSON válido" });
  }
  if (e?.type === "entity.too.large") {
    return res.status(413).json({ ok: false, message: "El pedido es demasiado grande" });
  }
  // El callback de cors() en config.ts rechaza con este Error — es un
  // origen no permitido, no una falla del servidor.
  if (err instanceof Error && err.message === "Origen no permitido por CORS") {
    return res.status(403).json({ ok: false, message: "Origen no permitido" });
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
      : "Ocurrió un error interno. Inténtalo de nuevo más tarde.";

  return res.status(500).json({
    ok: false,
    message,
  });
}