import { z } from "zod";

// El regex de event_date solo valida el formato (YYYY-MM-DD): "2026-02-30"
// lo cumple igual. Sin este chequeo, ese valor llega intacto hasta el
// ::date cast de Postgres y explota como un 500 con el mensaje crudo del
// driver. Mismo problema para event_time con horas/minutos fuera de rango
// (regex \d{2}:\d{2} deja pasar "29:99").
function isValidCalendarDate(value: string): boolean {
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function isValidClockTime(value: string): boolean {
  const [h, mi, s] = value.split(":").map(Number);
  if (h > 23 || mi > 59) return false;
  if (s !== undefined && s > 59) return false;
  return true;
}

// Nada impide hoy crear/editar dos categorías con el mismo tipo+rango+género
// dentro del mismo torneo (no hay constraint de DB para eso) — quedan como
// dos categorías indistinguibles en la lista de inscripción. Se valida acá,
// a nivel de request completo, porque es la única capa que ve el array
// entero de categorías de una sola vez.
function hasNoDuplicateCategories(
  categories?: Array<{ category_type: string; category_range: string; gender: string }>
): boolean {
  if (!categories) return true;
  const seen = new Set<string>();
  for (const c of categories) {
    const key = `${c.category_type.trim().toLowerCase()}|${c.category_range.trim().toLowerCase()}|${c.gender}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

const DUPLICATE_CATEGORY_MESSAGE = "Hay categorías repetidas (mismo tipo, rango y género)";

export const createTournamentSchema = z.object({
  tournament_name: z.string().min(1).max(150),
  // Nullable porque el frontend manda explícitamente `null` (no `undefined`)
  // en los campos opcionales vacíos — mismo patrón que ya tenía
  // updateTournamentSchema. Sin esto, crear un torneo sin descripción,
  // dirección u hora (el caso más común) rebotaba con 400.
  description: z.string().nullable().optional(),
  allow_mixed: z.boolean().default(true),
  allow_olympic: z.boolean().default(false),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isValidCalendarDate, { message: "Fecha inválida" }),
  event_time: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .refine(isValidClockTime, { message: "Hora inválida" })
    .nullable()
    .optional(),

  address: z.string().min(1).nullable().optional(),
  region: z.string().min(1).nullable().optional(),

  categories: z
    .array(
      z.object({
        id_category: z.string().uuid().optional(),
        category_type: z.string().min(1).max(20),
        category_range: z.string().min(1).max(100),
        gender: z.enum(["male", "female", "mixed"]),
        inscription_price: z.number().min(0),
        quotas: z.number().int().positive().nullable(),
        status: z.string().optional(),
        qualifiers_per_group: z.number().int().min(1).max(4).optional(),
      })
    )
    .optional()
    .refine(hasNoDuplicateCategories, { message: DUPLICATE_CATEGORY_MESSAGE }),
});

export type TournamentCreateDTO = z.infer<typeof createTournamentSchema>;

export const updateTournamentSchema = z.object({
  tournament_name: z.string().min(1).max(150).optional(),
  description: z.string().nullable().optional(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isValidCalendarDate, { message: "Fecha inválida" }).optional(),
  event_time: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .refine(isValidClockTime, { message: "Hora inválida" })
    .nullable()
    .optional(),

  address: z.string().min(1).nullable().optional(),
  region: z.string().min(1).nullable().optional(),

  categories: z
    .array(
      z.object({
        id_category: z.string().uuid().optional(),
        category_type: z.string().min(1).max(20),
        category_range: z.string().min(1).max(100),
        gender: z.enum(["male", "female", "mixed"]),
        inscription_price: z.number().min(0),
        quotas: z.number().int().positive().nullable(),
        qualifiers_per_group: z.number().int().min(1).max(4).optional(),
      })
    )
    .optional()
    .refine(hasNoDuplicateCategories, { message: DUPLICATE_CATEGORY_MESSAGE }),
});

export type TournamentUpdateDTO = z.infer<typeof updateTournamentSchema>;

export const adminAddPlayerSchema = z
  .object({
    id_user: z.string().uuid(),
    qualification_type: z.enum(["group", "direct_advance", "late_entry"]).optional(),
  })
  .strict();

export type AdminAddPlayerBody = z.infer<typeof adminAddPlayerSchema>;