import { Request, Response, NextFunction } from "express";

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  console.error("error server:", err);
  res.status(500).json({
    ok: false,
    message: "error from server",
  });
}
