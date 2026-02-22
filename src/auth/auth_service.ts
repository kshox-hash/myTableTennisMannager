import bcrypt from "bcrypt";
import { z } from "zod";
import jwt, { type Secret, type SignOptions } from "jsonwebtoken";

import type { RegisterDTO, LoginDTO, RoleName } from "../interfaces/dto/auth_dto";
import { AuthRepository } from "./auth_repository";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["admin", "player"]).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export class AuthService {
  constructor(private repo: AuthRepository) {}
private signToken(payload: { id_user: string; role: RoleName }) {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET_MISSING");
  }

  const options: SignOptions = {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? "7d") as any,
  };

  return jwt.sign(payload, secret as Secret, options);
}

  async register(input: RegisterDTO) {
    const data = registerSchema.parse(input);

    // ✅ en PROD: fuerza player
    const role: RoleName = data.role ?? "player";

    const email = data.email.trim().toLowerCase();

    const existing = await this.repo.findUserByEmail(email);
    if (existing) throw new Error("EMAIL_ALREADY_EXISTS");

    const id_role = await this.repo.findRoleIdByName(role);

    const password_hash = await bcrypt.hash(data.password, 10);

    const userRow = await this.repo.createUser({ email, password_hash, id_role });

    const token = this.signToken({ id_user: userRow.id_user, role });

    return {
      token,
      user: {
        id_user: userRow.id_user,
        email: userRow.email,
        role,
      },
    };
  }

  async login(input: LoginDTO) {
    const data = loginSchema.parse(input);

    const email = data.email.trim().toLowerCase();

    const user = await this.repo.findUserByEmail(email);
    if (!user) throw new Error("INVALID_CREDENTIALS");

    const ok = await bcrypt.compare(data.password, user.password_hash);
    if (!ok) throw new Error("INVALID_CREDENTIALS");

    const role = (user.role as string).toLowerCase() as RoleName;

    const token = this.signToken({ id_user: user.id_user, role });

    return {
      token,
      user: {
        id_user: user.id_user,
        email: user.email,
        role,
      },
    };
  }

  async me(id_user: string) {
    // si quieres, puedes traer más data por id_user.
    // por ahora basta con el token payload y/o buscar por email.
    return { id_user };
  }
}
