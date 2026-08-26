import jwt, { type Secret, type SignOptions } from "jsonwebtoken";

export function signToken(payload: { id_user: string; role: string }) {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET_MISSING");
  }

  const options: SignOptions = {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? "7d") as any,
  };

  return jwt.sign(payload, secret as Secret, options);
}