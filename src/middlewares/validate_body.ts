import { z, ZodType } from "zod";
import { Request, Response, NextFunction } from "express";

export const validateBody =
  <T>(schema: ZodType<T>) =>
  (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "invalid data",
        errors: result.error.issues.map(e => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
    }
    req.body = result.data as T;
    next();
  };

  