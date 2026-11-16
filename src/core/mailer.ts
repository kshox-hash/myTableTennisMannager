// Envío de emails transaccionales (código para recuperar la contraseña,
// acceso a la prueba gratis, aviso de solicitudes de demo).
//
// Dos formas de enviar; se usa la primera que esté configurada:
//
//  1) Gmail propio (SMTP con contraseña de aplicación):
//       GMAIL_USER          — la cuenta, ej. myttmadmin@gmail.com
//       GMAIL_APP_PASSWORD  — contraseña de aplicación de 16 letras
//                             (Cuenta de Google → Seguridad → Verificación en
//                             2 pasos → Contraseñas de aplicaciones). NO es la
//                             contraseña normal de la cuenta.
//     Límite de Gmail: ~500 destinatarios por día.
//
//  2) Resend (API HTTP):
//       RESEND_API_KEY  — clave de https://resend.com
//
//  MAIL_FROM (opcional) — remitente. Con Gmail, por defecto "MyTTM <GMAIL_USER>"
//  (Gmail siempre manda desde la cuenta autenticada; acá solo cambia el nombre).
//  Con Resend, por defecto "MyTTM <no-reply@myttm.cl>" (dominio verificado).
//
// Sin ninguna configurada el server igual levanta: sendMail devuelve false y
// en desarrollo se imprime el email en consola para probar sin proveedor.
import nodemailer, { type Transporter } from "nodemailer";

const gmailUser = process.env.GMAIL_USER?.trim();
const gmailPass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, ""); // Google la muestra en bloques con espacios
const resendKey = process.env.RESEND_API_KEY;

const provider: "gmail" | "resend" | null = gmailUser && gmailPass ? "gmail" : resendKey ? "resend" : null;
const from =
  process.env.MAIL_FROM ?? (provider === "gmail" ? `MyTTM <${gmailUser}>` : "MyTTM <no-reply@myttm.cl>");

export const mailConfigured = provider !== null;
export const mailProvider = provider;

let gmail: Transporter | null = null;
function gmailTransport(): Transporter {
  gmail ??= nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailPass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return gmail;
}

export async function sendMail(to: string, subject: string, html: string, text: string): Promise<boolean> {
  if (!provider) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[mailer] (sin proveedor de correo) a ${to}: ${subject}\n${text}`);
    } else {
      console.error("[mailer] sin GMAIL_USER/GMAIL_APP_PASSWORD ni RESEND_API_KEY: no se envió el email");
    }
    return false;
  }

  try {
    if (provider === "gmail") {
      await gmailTransport().sendMail({ from, to, subject, html, text });
      return true;
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[mailer] Resend respondió ${res.status}: ${await res.text()}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[mailer] error enviando email (${provider})`, e);
    return false;
  }
}
