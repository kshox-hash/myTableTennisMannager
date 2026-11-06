import type { Request, Response, NextFunction } from "express";

/**
 * Pasa a forma compuesta (Unicode NFC) todo texto que llega en el cuerpo de
 * un pedido, antes de cualquier validación o guardado.
 *
 * Hay nombres que llegan con la Ñ y las tildes "descompuestas" (N + tilde
 * combinable U+0303), típico de texto pegado desde Excel o tipeado en iPhone.
 * Se ven bien en pantalla, pero rompen los PDF (jsPDF dibuja la línea entera
 * mal), las búsquedas ("muñoz" no encontraba "MUÑOZ" descompuesto) y las
 * comparaciones de nombres repetidos. Guardando todo en NFC desaparece el
 * problema de raíz.
 */
export function normalizeTextBody(req: Request, _res: Response, next: NextFunction) {
  if (req.body !== undefined) req.body = toNFC(req.body);
  next();
}

function toNFC(value: unknown): unknown {
  if (typeof value === "string") return value.normalize("NFC");
  if (Array.isArray(value)) return value.map(toNFC);
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toNFC(v);
    return out;
  }
  return value;
}
