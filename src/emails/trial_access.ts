// Correo con el acceso a la prueba gratis de 14 días.
// Los textos se editan acá; el logo, colores y pie de página en ./layout.ts.
import { BRAND, WEB_URL, emailLayout, esc, p } from "./layout";

export function trialAccessEmail(opts: { name?: string | null; email: string; password: string; expiresAt: Date | string }) {
  const until = new Date(opts.expiresAt).toLocaleDateString("es-CL", { day: "numeric", month: "long", timeZone: "America/Santiago" });
  const loginUrl = `${WEB_URL}/login`;
  const hello = opts.name ? `Hola ${esc(opts.name)},` : "Hola,";

  const subject = "Tu prueba gratis de MyTTM está lista";

  const access = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;background:#f8fafc;border-radius:12px">
      <tr><td style="padding:16px 18px;font-size:14px;line-height:1.7;color:${BRAND.text}">
        <span style="color:${BRAND.muted}">Correo</span><br>
        <strong style="color:${BRAND.ink}">${esc(opts.email)}</strong><br>
        <span style="color:${BRAND.muted}">Contraseña</span><br>
        <strong style="color:${BRAND.ink};font-family:Consolas,Menlo,monospace;font-size:16px;letter-spacing:1px">${esc(opts.password)}</strong>
      </td></tr>
    </table>`;

  const html = emailLayout({
    preheader: `14 días para organizar tus campeonatos con MyTTM (hasta el ${until}).`,
    title: "Tu prueba gratis está lista",
    body:
      p(hello) +
      p(
        `Ya tienes acceso a <strong>MyTTM</strong> por <strong>14 días</strong>, hasta el <strong>${esc(until)}</strong>. ` +
          `Es una cuenta real: los campeonatos que crees quedan guardados y tus jugadores se pueden inscribir.`
      ) +
      p("Estos son tus datos para entrar:") +
      access,
    cta: { label: "Entrar a MyTTM", url: loginUrl },
    after:
      p("Al entrar te mostramos un recorrido corto por lo principal: crear el campeonato, inscripciones, grupos, llaves y mesas en vivo.") +
      p(
        `<strong>Recuerda que esta es una demo.</strong> Puedes solicitar el programa completo, que es gratis: ` +
          `responde este correo o escríbenos a <a href="mailto:${esc(BRAND.contactEmail)}" style="color:${BRAND.ink}">${esc(BRAND.contactEmail)}</a>.`
      ) +
      p("Te recomendamos cambiar la contraseña desde tu perfil."),
  });

  const text = [
    hello,
    "",
    `Ya tienes acceso a MyTTM por 14 días, hasta el ${until}. Es una cuenta real: los campeonatos que crees quedan guardados.`,
    "",
    `Entra en: ${loginUrl}`,
    `Correo: ${opts.email}`,
    `Contraseña: ${opts.password}`,
    "",
    "Al entrar te mostramos un recorrido corto por lo principal.",
    "",
    "Recuerda que esta es una demo. Puedes solicitar el programa completo, que es gratis: responde este correo.",
    "",
    `¿Dudas? Escríbenos a ${BRAND.contactEmail}`,
  ].join("\n");

  return { subject, html, text };
}
