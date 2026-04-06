import { ERRORS, type AuthError, type AuthSuccess } from "../auth/dto/auth_dto";
import { AuthRepository } from "./auth_repository";
import type { SignInDTO, SignUpDTO } from "./schema/auth_schema";
import { Result, ok, fail } from "../core/constants/result";
import { hashPassword, comparePassword } from "../bcrypt/bcrypt";
import { signToken } from "../jwt/jwt";

export class AuthService {
  constructor(private repo: AuthRepository) {}

  async register(input: SignUpDTO): Promise<Result<AuthSuccess, AuthError>> {
    const existing = await this.repo.findUserByEmail(input.email);

    if (existing) {
      return fail<AuthError>(ERRORS.EMAIL_ALREADY_EXISTS);
    }

    const password_hash = await hashPassword(input.password);

    const userCreated = await this.repo.createUser({
      email: input.email,
      password_hash,
    });

    const token = signToken({ id_user: userCreated.id_user });

    return ok<AuthSuccess>({
      token,
      user: {
        id_user: userCreated.id_user,
        email: userCreated.email,
        role: "player",
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

    const token = signToken({ id_user: user.id_user });

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