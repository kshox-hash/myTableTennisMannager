import { z } from "zod";

export const enrollmentSchema = z
  .object({
    id_user: z.string().uuid("id_user inválido"),
    id_tournament: z.string().uuid("id_tournament inválido"),
    id_category: z.string().uuid("id_category inválido"),
  })
  .strict();

export type EnrollmentDTO = Readonly<z.infer<typeof enrollmentSchema>>;