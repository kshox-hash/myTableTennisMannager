import { z } from "zod";

export const CreateTournamentSchema = z.object({
  tournament_name: z.string().trim().min(3, "Tournament name must be at least 3 characters long"),

  description: z.string().trim().min(1, "Description is required"),

  categories: z.array(
    z.object({
      category_name: z.string().trim().min(1, "Category name is required"),

      gender: z.enum(["male", "female"], "Gender must be 'male' or 'female'"),

      inscription_price: z.number().min(0, "Inscription price must be greater than or equal to 0"),

      quotas: z.number().int("Quotas must be an integer").min(1, "Quotas must be at least 1"),
    }).strict()
  ).min(1, "At least one category is required"),

  location: z.string().trim().min(2, "Location is required"),

  created_by: z.string().trim().min(1, "Created by is required"),
}).strict();

export type CreateTournamentDTO = z.infer<typeof CreateTournamentSchema>;
