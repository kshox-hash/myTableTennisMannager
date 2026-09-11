import { OAuth2Client } from "google-auth-library";
import { ERRORS, type AuthError, type AuthSuccess } from "../auth/dto/auth_dto";
import { AuthRepository } from "./auth_repository";
import type { SignInDTO, SignUpDTO } from "./schema/auth_schema";
import { Result, ok, fail } from "../core/constants/result";
import { hashPassword, comparePassword } from "../bcrypt/bcrypt";
import { signToken } from "../jwt/jwt";
import { ROLE_IDS } from "../core/constants/roles";

// Sin GOOGLE_CLIENT_ID el server igual levanta (dev local sin Google
// configurado) — el endpoint /auth/google devuelve error recién cuando se
// llama, no rompe el boot. Mismo criterio que r2_client.ts con R2.
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClient = googleClientId ? new OAuth2Client(googleClientId) : null;

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

    // Cuenta creada por Google: no tiene password_hash, así que nunca puede
    // entrar por acá — se lo decimos explícito en vez de un genérico
    // "credenciales inválidas" que la haría pensar que escribió mal la clave.
    if (!user.password_hash) {
      return fail<AuthError>(ERRORS.GOOGLE_ONLY_ACCOUNT);
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

  // Login/registro con Google en un solo paso: el frontend manda el
  // "credential" (ID token JWT) que entrega Google Identity Services al
  // tocar el botón. Acá se verifica la firma contra Google (nunca se
  // confía en el contenido sin verificar) y, según el caso:
  //   1) ya existe una cuenta con este google_sub → login directo.
  //   2) existe una cuenta con este email (se registró por email antes) →
  //      se vincula el google_sub a esa cuenta y entra ahí (une las dos
  //      formas de entrar a la MISMA cuenta, no crea una duplicada).
  //   3) no existe nada → se crea un jugador nuevo, sin contraseña, con el
  //      nombre/apellido/foto que vengan del token.
  // profile_incomplete avisa al frontend si hace falta mandar a completar
  // género/club/etc. (Google no lo pregunta, así que se completa aparte).
  async loginWithGoogle(idToken: string): Promise<Result<AuthSuccess, AuthError>> {
    if (!googleClient) {
      return fail<AuthError>(ERRORS.GOOGLE_TOKEN_INVALID);
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken, audience: googleClientId });
      payload = ticket.getPayload();
    } catch {
      return fail<AuthError>(ERRORS.GOOGLE_TOKEN_INVALID);
    }
    if (!payload?.sub || !payload.email) {
      return fail<AuthError>(ERRORS.GOOGLE_TOKEN_INVALID);
    }

    let profile = await this.repo.findAuthProfileByGoogleSub(payload.sub);

    if (!profile) {
      const existing = await this.repo.findAuthProfileByEmail(payload.email);
      if (existing) {
        // Solo vincula si Google confirma que el dueño del email lo
        // verificó — si no, cualquiera con un token de un email no
        // verificado podría "entrar" a una cuenta ajena con solo saber su
        // correo.
        if (!payload.email_verified) {
          return fail<AuthError>(ERRORS.GOOGLE_TOKEN_INVALID);
        }
        await this.repo.linkGoogleSub(existing.id_user, payload.sub);
        profile = { ...existing, google_sub: payload.sub };
      } else {
        profile = await this.repo.createGoogleUser({
          email: payload.email,
          google_sub: payload.sub,
          first_name: payload.given_name,
          last_name: payload.family_name,
          avatar_url: payload.picture,
        });
      }
    }

    const token = signToken({ id_user: profile.id_user, role: profile.role });

    return ok<AuthSuccess>({
      token,
      user: {
        id_user: profile.id_user,
        email: profile.email,
        role: profile.role,
      },
      // Solo aplica a jugadores — un admin que se logueó por Google
      // (vinculó una cuenta admin ya existente, por ejemplo) no tiene por
      // qué pasar por la ficha de jugador (género/club no le sirven).
      profile_incomplete: profile.role === "player" && profile.gender == null,
    });
  }
}