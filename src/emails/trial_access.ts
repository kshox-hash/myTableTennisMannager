// Correo con el acceso a la prueba gratis de 14 días.
// Los textos se editan acá; el logo, colores, cabecera y pie en ./layout.ts.
import { BRAND, WEB_URL, callout, emailLayout, esc, label, p, steps } from "./layout";

export function trialAccessEmail(opts: { name?: string | null; email: string; password: string; expiresAt: Date | string }) {
  const until = new Date(opts.expiresAt).toLocaleDateString("es-CL", { day: "numeric", month: "long", timeZone: "America/Santiago" });
  const loginUrl = `${WEB_URL}/login`;
  const hello = opts.name ? `Hola ${esc(opts.name)},` : "Hola,";

  const subject = "Tu prueba gratis de MyTTM está lista";

  // El correo va dentro de un link propio (sin subrayado) para que Gmail no
  // lo convierta en un link azul.
  const access = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;background:${BRAND.soft};border:1px solid #e2e8f0;border-radius:12px">
      <tr><td style="padding:16px 18px 6px;font-size:12px;color:${BRAND.muted}">Correo</td></tr>
      <tr><td style="padding:0 18px 12px;font-size:15px;font-weight:bold">
        <a href="${esc(loginUrl)}" style="color:${BRAND.ink};text-decoration:none">${esc(opts.email)}</a>
      </td></tr>
      <tr><td style="padding:0 18px"><div style="border-top:1px solid #e2e8f0;line-height:1px;font-size:0">&nbsp;</div></td></tr>
      <tr><td style="padding:12px 18px 6px;font-size:12px;color:${BRAND.muted}">Contraseña</td></tr>
      <tr><td style="padding:0 18px 16px;font-family:Consolas,Menlo,monospace;font-size:17px;font-weight:bold;letter-spacing:1px;color:${BRAND.ink}">${esc(opts.password)}</td></tr>
    </table>`;

  const html = emailLayout({
    preheader: `14 días para organizar tus campeonatos con MyTTM (hasta el ${until}).`,
    eyebrow: `Prueba gratis · hasta el ${until}`,
    title: "Tu prueba gratis está lista",
    body:
      p(hello) +
      p(
        `Ya tienes acceso a <strong>MyTTM</strong> por <strong>14 días</strong>. ` +
          `Es una cuenta real: los campeonatos que crees quedan guardados y tus jugadores se pueden inscribir.`
      ) +
      label("Tus datos para entrar") +
      access,
    cta: { label: "Entrar a MyTTM", url: loginUrl },
    after:
      label("Qué puedes hacer") +
      steps([
        { title: "Crea tu campeonato", text: "Categorías, formato y fechas en un par de minutos." },
        { title: "Abre las inscripciones", text: "Tus jugadores se inscriben y pagan desde su teléfono." },
        { title: "Juega en vivo", text: "Grupos, llaves y mesas se actualizan solos hasta la final." },
      ]) +
      p("Al entrar te mostramos un recorrido corto por todo esto.") +
      callout(
        `<strong style="color:${BRAND.ink}">Recuerda que esta es una demo.</strong> Puedes solicitar el programa completo, que es gratis: ` +
          `responde este correo o escríbenos a <a href="mailto:${esc(BRAND.contactEmail)}" style="color:${BRAND.ink};font-weight:bold">${esc(BRAND.contactEmail)}</a>.`
      ) +
      `<p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:${BRAND.muted}">Te recomendamos cambiar la contraseña desde tu perfil.</p>`,
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
    "Qué puedes hacer:",
    "1. Crea tu campeonato: categorías, formato y fechas en un par de minutos.",
    "2. Abre las inscripciones: tus jugadores se inscriben y pagan desde su teléfono.",
    "3. Juega en vivo: grupos, llaves y mesas se actualizan solos hasta la final.",
    "",
    "Recuerda que esta es una demo. Puedes solicitar el programa completo, que es gratis: responde este correo.",
    "",
    `¿Dudas? Escríbenos a ${BRAND.contactEmail}`,
  ].join("\n");

  return { subject, html, text };
}
