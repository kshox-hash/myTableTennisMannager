// Diseño común de los correos de MyTTM: logo arriba, contenido, botón y pie.
//
// ── Para cambiar cómo se ven los correos, edita BRAND (abajo). ──
//   - logo: imagen PNG pública (los correos no muestran SVG ni webp).
//     Hoy es myttmi-web/public/email/logo.png, servida por la web.
//   - colores, nombre, links del pie, redes, dirección legal, etc.
// Los correos usan tablas y estilos en línea a propósito: Gmail, Outlook y
// Apple Mail ignoran casi todo el CSS moderno (<style>, flex, grid).

export const WEB_URL = (process.env.WEB_URL ?? "https://www.my-ttm.com").replace(/\/+$/, "");

export const BRAND = {
  name: "MyTTM",
  tagline: "Campeonatos de tenis de mesa, de la inscripción a la final",
  logoUrl: `${WEB_URL}/email/logo.png`,
  logoSize: 56,
  // Colores (los de la web).
  accent: "#b5e22e", // botón
  accentText: "#0b1a12",
  ink: "#0f1720", // títulos
  text: "#334155", // párrafos
  muted: "#64748b",
  bg: "#f1f5f9", // fondo exterior
  card: "#ffffff",
  // Pie de página.
  footerLinks: [
    { label: "my-ttm.com", url: WEB_URL },
    { label: "Instagram", url: "https://www.instagram.com/mytabletennismanager" },
  ],
  contactEmail: "myttmadmin@gmail.com",
  footerNote: "Recibes este correo porque se creó una cuenta de MyTTM con esta dirección.",
};

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Párrafo con el estilo de los correos. `html` ya escapado. */
export const p = (html: string) =>
  `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${BRAND.text}">${html}</p>`;

export function emailLayout(opts: {
  /** Texto corto que muestran las bandejas junto al asunto. */
  preheader: string;
  title: string;
  /** Contenido (HTML ya escapado), va entre el título y el botón. */
  body: string;
  cta?: { label: string; url: string };
  /** Contenido extra bajo el botón (HTML ya escapado). */
  after?: string;
}): string {
  const b = BRAND;
  const button = opts.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr><td style="border-radius:999px;background:${b.accent}">
         <a href="${esc(opts.cta.url)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:bold;color:${b.accentText};text-decoration:none;border-radius:999px">${esc(opts.cta.label)}</a>
       </td></tr></table>`
    : "";
  const links = b.footerLinks
    .map((l) => `<a href="${esc(l.url)}" style="color:${b.muted};text-decoration:underline">${esc(l.label)}</a>`)
    .join(" &nbsp;·&nbsp; ");

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.title)}</title></head>
<body style="margin:0;padding:0;background:${b.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${b.bg}"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:Arial,Helvetica,sans-serif">
    <tr><td align="center" style="padding:0 0 20px">
      <img src="${esc(b.logoUrl)}" width="${b.logoSize}" height="${b.logoSize}" alt="${esc(b.name)}" style="display:block;border:0">
    </td></tr>
    <tr><td style="background:${b.card};border-radius:16px;padding:32px 28px">
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${b.ink}">${esc(opts.title)}</h1>
      ${opts.body}
      ${button}
      ${opts.after ?? ""}
    </td></tr>
    <tr><td align="center" style="padding:22px 12px 0;font-size:12px;line-height:1.6;color:${b.muted}">
      <p style="margin:0 0 6px"><strong style="color:${b.ink}">${esc(b.name)}</strong> · ${esc(b.tagline)}</p>
      <p style="margin:0 0 6px">${links}</p>
      <p style="margin:0 0 6px">¿Dudas? Escríbenos a <a href="mailto:${esc(b.contactEmail)}" style="color:${b.muted}">${esc(b.contactEmail)}</a></p>
      <p style="margin:0">${esc(b.footerNote)}</p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}
