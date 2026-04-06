import { z } from "zod";

export const createTournamentSchema = z.object({
  tournament_name: z.string().min(1).max(150),
  description: z.string().optional(),
  created_by: z.string().uuid(),
  allow_mixed: z.boolean().default(true),
  allow_olympic: z.boolean().default(false),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  event_time: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .optional(),

  address: z.string().min(1).optional(),
  region: z.string().min(1).optional(),

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
      })
    )
    .optional(),
});

export type TournamentCreateDTO = z.infer<typeof createTournamentSchema>;