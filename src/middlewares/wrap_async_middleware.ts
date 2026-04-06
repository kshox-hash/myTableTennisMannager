import type {
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from "express";

type AsyncController = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<any>;

export function asyncHandler(fn: AsyncController): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}