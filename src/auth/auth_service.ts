import { OAuth2Client } from "google-auth-library";
import { ERRORS, type AuthError, type AuthSuccess } from "../auth/dto/auth_dto";
import { AuthRepository } from "./auth_repository";
import type { SignInDTO, SignUpDTO, ResetPasswordDTO } from "./schema/auth_schema";
import { Result, ok, fail } from "../core/constants/result";
import { hashPassword, comparePassword } from "../bcrypt/bcrypt";
import { signToken } from "../jwt/jwt";
import { ROLE_IDS, resolveEffectiveRole } from "../core/constants/roles";
import { randomInt } from "crypto";
import { sendMail } from "../core/mailer";

const RESET_CODE_TTL_MS = 15 * 60 * 1000;
const RESET_MAX_ATTEMPTS = 5;

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
      dominant_hand: input.dominant_hand,
      birth_date: input.birth_date,
      country: input.country,
      region: input.region,
      id_document: input.id_document,
      category: input.category,
    });

    const effectiveRole = resolveEffectiveRole(userCreated.email, role);
    const token = signToken({ id_user: userCreated.id_user, role: effectiveRole });

    return ok<AuthSuccess>({
      token,
      user: {
        id_user: userCreated.id_user,
        email: userCreated.email,
        role: effectiveRole,
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

    const effectiveRole = resolveEffectiveRole(user.email, user.role);
    const token = signToken({ id_user: user.id_user, role: effectiveRole });

    return ok<AuthSuccess>({
      token,
      user: {
        id_user: user.id_user,
        email: user.email,
        role: effectiveRole,
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

    const effectiveRole = resolveEffectiveRole(profile.email, profile.role);
    const token = signToken({ id_user: profile.id_user, role: effectiveRole });

    return ok<AuthSuccess>({
      token,
      user: {
        id_user: profile.id_user,
        email: profile.email,
        role: effectiveRole,
      },
      // Solo aplica a jugadores — un admin que se logueó por Google
      // (vinculó una cuenta admin ya existente, por ejemplo) no tiene por
      // qué pasar por la ficha de jugador (género/club no le sirven).
      profile_incomplete: profile.role === "player" && profile.gender == null,
    });
  }

  // --- Recuperar contraseña: código de 6 dígitos por email ---
  //
  // forgotPassword no dice si el email existe (el controller responde
  // siempre igual) para no revelar qué correos tienen cuenta. Sirve también
  // para una cuenta creada con Google: así puede ponerse una contraseña.
  async forgotPassword(email: string): Promise<void> {
    const user = await this.repo.findUserByEmail(email);
    if (!user) return;

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    await this.repo.saveResetCode(user.id_user, await hashPassword(code), new Date(Date.now() + RESET_CODE_TTL_MS));

    await sendMail(
      user.email,
      `Tu código de MyTTM: ${code}`,
      `<div style="font-family:Arial,sans-serif;max-width:420px">
         <h2 style="margin:0 0 12px">Recupera tu contraseña</h2>
         <p>Usa este código en la app para crear una contraseña nueva:</p>
         <p style="font-size:32px;font-weight:bold;letter-spacing:6px;margin:16px 0">${code}</p>
         <p style="color:#666">Vence en 15 minutos. Si no lo pediste, ignora este correo: tu cuenta sigue igual.</p>
       </div>`,
      `Tu código para recuperar la contraseña de MyTTM es ${code}. Vence en 15 minutos. Si no lo pediste, ignora este correo.`
    );
  }

  async resetPassword(input: ResetPasswordDTO): Promise<Result<AuthSuccess, AuthError>> {
    const user = await this.repo.findUserByEmail(input.email);
    if (!user) return fail<AuthError>(ERRORS.RESET_CODE_INVALID);

    const saved = await this.repo.findResetCode(user.id_user);
    if (!saved) return fail<AuthError>(ERRORS.RESET_CODE_INVALID);
    if (new Date(saved.expires_at).getTime() < Date.now() || saved.attempts >= RESET_MAX_ATTEMPTS) {
      return fail<AuthError>(ERRORS.RESET_CODE_EXPIRED);
    }

    if (!(await comparePassword(input.code, saved.code_hash))) {
      await this.repo.bumpResetAttempts(user.id_user);
      return fail<AuthError>(ERRORS.RESET_CODE_INVALID);
    }

    await this.repo.setPasswordAndClearCode(user.id_user, await hashPassword(input.password));

    // Entra directo con la contraseña nueva (sin volver a tipearla).
    const effectiveRole = resolveEffectiveRole(user.email, user.role);
    const token = signToken({ id_user: user.id_user, role: effectiveRole });
    return ok<AuthSuccess>({
      token,
      user: { id_user: user.id_user, email: user.email, role: effectiveRole },
    });
  }
}