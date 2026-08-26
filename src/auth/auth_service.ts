import { ERRORS, type AuthError, type AuthSuccess } from "../auth/dto/auth_dto";
import { AuthRepository } from "./auth_repository";
import type { SignInDTO, SignUpDTO } from "./schema/auth_schema";
import { Result, ok, fail } from "../core/constants/result";
import { hashPassword, comparePassword } from "../bcrypt/bcrypt";
import { signToken } from "../jwt/jwt";
import { ROLE_IDS } from "../core/constants/roles";

export class AuthService {
  constructor(private repo: AuthRepository) {}

  async register(input: SignUpDTO): Promise<Result<AuthSuccess, AuthError>> {
    const existing = await this.repo.findUserByEmail(input.email);

    if (existing) {
      return fail<AuthError>(ERRORS.EMAIL_ALREADY_EXISTS);
    }

    if (input.role === "admin") {
      const expected = process.env.ADMIN_SECRET;
      if (!expected || input.admin_secret !== expected) {
        return fail<AuthError>(ERRORS.INVALID_ADMIN_SECRET);
      }
    }

    const password_hash = await hashPassword(input.password);

    const role: "admin" | "player" = input.role === "admin" ? "admin" : "player";
    const id_role = role === "admin" ? ROLE_IDS.admin : ROLE_IDS.player;

    const userCreated = await this.repo.createUser({
      email: input.email,
      password_hash,
      id_role,
      first_name: input.first_name,
      last_name: input.last_name,
      gender: input.gender,
      club_name: input.club_name,
      birth_date: input.birth_date,
      country: input.country,
      id_document: input.id_document,
      category: input.category,
    });

    const token = signToken({ id_user: userCreated.id_user, role });

    return ok<AuthSuccess>({
      token,
      user: {
        id_user: userCreated.id_user,
        email: userCreated.email,
        role,
      },
    });
  }

  async login(input: SignInDTO): Promise<Result<AuthSuccess, AuthError>> {
    const user = await this.repo.findUserByEmail(input.email);

    if (!user) {
      return fail<AuthError>(ERRORS.INVALID_CREDENTIALS);
    }

    const isPasswordValid = await comparePassword(
      input.password,
      user.password_hash
    );

    if (!isPasswordValid) {
      return fail<AuthError>(ERRORS.INVALID_CREDENTIALS);
    }

    const token = signToken({ id_user: user.id_user, role: user.role });

    return ok<AuthSuccess>({
      token,
      user: {
        id_user: user.id_user,
        email: user.email,
        role: user.role,
      },
    });
  }
}