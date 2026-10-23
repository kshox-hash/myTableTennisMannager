// Envío de emails transaccionales (por ahora solo el código para recuperar
// la contraseña) vía la API HTTP de Resend — sin dependencia nueva, con el
// fetch nativo de Node.
//
// Variables de entorno:
//   RESEND_API_KEY  — clave de https://resend.com (obligatoria para enviar)
//   MAIL_FROM       — remitente, con dominio verificado en Resend.
//                     Default: "MyTTM <no-reply@myttm.cl>"
//
// Sin RESEND_API_KEY el server igual levanta (mismo criterio que R2 y
// Google): sendMail devuelve false. En desarrollo además se imprime el
// email en consola para poder probar el flujo sin proveedor.

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.MAIL_FROM ?? "MyTTM <no-reply@myttm.cl>";

export const mailConfigured = Boolean(apiKey);

export async function sendMail(to: string, subject: string, html: string, text: string): Promise<boolean> {
  if (!apiKey) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[mailer] (sin RESEND_API_KEY) a ${to}: ${subject}\n${text}`);
    } else {
      console.error("[mailer] RESEND_API_KEY no configurada: no se envió el email");
    }
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[mailer] Resend respondió ${res.status}: ${await res.text()}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[mailer] error enviando email", e);
    return false;
  }
}
