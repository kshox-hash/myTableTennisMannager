// Diseño común de los correos de MyTTM: cabecera oscura con el logo,
// contenido en tarjeta blanca, botón y pie de página oscuro.
//
// ── Para cambiar cómo se ven los correos, edita BRAND (abajo). ──
//   - logo: imagen PNG pública (los correos no muestran SVG ni webp).
//     Hoy es myttmi-web/public/email/logo.png, servida por la web.
//   - colores, nombre, links del pie, redes, etc.
// Los correos usan tablas y estilos en línea a propósito: Gmail, Outlook y
// Apple Mail ignoran casi todo el CSS moderno (<style>, flex, grid).

export const WEB_URL = (process.env.WEB_URL ?? "https://www.my-ttm.com").replace(/\/+$/, "");

export const BRAND = {
  name: "MyTTM",
  tagline: "Campeonatos de tenis de mesa, de la inscripción a la final",
  logoUrl: `${WEB_URL}/email/logo.png`,
  logoSize: 40,
  // Colores (los de la web).
  accent: "#b5e22e", // botón y franja de la cabecera
  accentText: "#0b1a12",
  dark: "#0f1720", // cabecera y pie
  darkLine: "#243241",
  onDark: "#e2e8f0",
  onDarkMuted: "#94a3b8",
  ink: "#0f1720", // títulos
  text: "#334155", // párrafos
  muted: "#64748b",
  bg: "#eef2f6", // fondo exterior
  card: "#ffffff",
  soft: "#f6f8fa", // recuadros dentro de la tarjeta
  // Pie de página.
  footerLinks: [
    { label: "my-ttm.com", url: WEB_URL },
    { label: "Instagram", url: "https://www.instagram.com/mytabletennismanager" },
    { label: "Ayuda", url: "mailto:myttmadmin@gmail.com" },
  ],
  contactEmail: "myttmadmin@gmail.com",
  country: "Hecho en Chile",
  footerNote: "Recibes este correo porque se creó una cuenta de MyTTM con esta dirección.",
};

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Párrafo con el estilo de los correos. `html` ya escapado. */
export const p = (html: string) =>
  `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${BRAND.text}">${html}</p>`;

/** Subtítulo pequeño en mayúsculas para separar secciones. */
export const label = (text: string) =>
  `<p style="margin:20px 0 12px;font-size:11px;font-weight:bold;letter-spacing:1.2px;text-transform:uppercase;color:${BRAND.muted}">${esc(text)}</p>`;

/** Pasos numerados (círculo verde + título + detalle). */
export function steps(items: { title: string; text: string }[]): string {
  const b = BRAND;
  const rows = items
    .map(
      (s, i) => `<tr>
        <td width="40" valign="top" style="padding:0 0 14px">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" valign="middle" width="28" height="28"
            style="width:28px;height:28px;border-radius:14px;background:${b.accent};color:${b.accentText};font-size:13px;font-weight:bold;line-height:28px">${i + 1}</td></tr></table>
        </td>
        <td valign="top" style="padding:3px 0 14px;font-size:14px;line-height:1.5;color:${b.text}">
          <strong style="color:${b.ink}">${esc(s.title)}</strong><br>${esc(s.text)}
        </td>
      </tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px">${rows}</table>`;
}

/** Recuadro destacado: fondo suave con borde verde a la izquierda. `html` ya escapado. */
export const callout = (html: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px"><tr>
     <td style="background:${BRAND.soft};border-left:4px solid ${BRAND.accent};border-radius:8px;padding:14px 16px;font-size:14px;line-height:1.6;color:${BRAND.text}">${html}</td>
   </tr></table>`;

export function emailLayout(opts: {
  /** Texto corto que muestran las bandejas junto al asunto. */
  preheader: string;
  /** Etiqueta pequeña sobre el título (p. ej. "Prueba gratis · 14 días"). */
  eyebrow?: string;
  title: string;
  /** Contenido (HTML ya escapado), va entre el título y el botón. */
  body: string;
  cta?: { label: string; url: string };
  /** Contenido extra bajo el botón (HTML ya escapado). */
  after?: string;
}): string {
  const b = BRAND;
  const year = new Date().getFullYear();
  const button = opts.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 24px"><tr><td style="border-radius:999px;background:${b.accent}">
         <a href="${esc(opts.cta.url)}" style="display:inline-block;padding:14px 30px;font-size:15px;font-weight:bold;color:${b.accentText};text-decoration:none;border-radius:999px">${esc(opts.cta.label)} &rarr;</a>
       </td></tr></table>`
    : "";
  const links = b.footerLinks
    .map((l) => `<a href="${esc(l.url)}" style="color:${b.onDark};text-decoration:none;font-weight:bold">${esc(l.label)}</a>`)
    .join(`<span style="color:${b.onDarkMuted}">&nbsp;&nbsp;·&nbsp;&nbsp;</span>`);
  const eyebrow = opts.eyebrow
    ? `<p style="margin:0 0 10px"><span style="display:inline-block;padding:4px 11px;border-radius:999px;background:#f1fadb;color:#4d6b06;font-size:12px;font-weight:bold">${esc(opts.eyebrow)}</span></p>`
    : "";

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(opts.title)}</title></head>
<body style="margin:0;padding:0;background:${b.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${b.bg}"><tr><td align="center" style="padding:28px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;font-family:Arial,Helvetica,sans-serif">

    <!-- Cabecera -->
    <tr><td style="background:${b.dark};border-radius:18px 18px 0 0;padding:20px 28px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td valign="middle">
          <a href="${esc(WEB_URL)}" style="text-decoration:none">
            <img src="${esc(b.logoUrl)}" width="${b.logoSize}" height="${b.logoSize}" alt="" style="display:inline-block;vertical-align:middle;border:0">
            <span style="display:inline-block;vertical-align:middle;margin-left:10px;font-size:22px;font-weight:bold;letter-spacing:-0.5px;color:#ffffff">${esc(b.name)}</span>
          </a>
        </td>
        <td align="right" valign="middle" style="font-size:12px;color:${b.onDarkMuted}">Tenis de mesa</td>
      </tr></table>
    </td></tr>
    <tr><td style="background:${b.accent};height:4px;line-height:4px;font-size:0">&nbsp;</td></tr>

    <!-- Contenido -->
    <tr><td style="background:${b.card};padding:32px 28px 14px">
      ${eyebrow}
      <h1 style="margin:0 0 18px;font-size:24px;line-height:1.25;letter-spacing:-0.3px;color:${b.ink}">${esc(opts.title)}</h1>
      ${opts.body}
      ${button}
      ${opts.after ?? ""}
    </td></tr>

    <!-- Pie -->
    <tr><td style="background:${b.dark};border-radius:0 0 18px 18px;padding:26px 28px;font-size:12px;line-height:1.6;color:${b.onDarkMuted}">
      <p style="margin:0 0 4px;font-size:15px;font-weight:bold;color:#ffffff">${esc(b.name)}</p>
      <p style="margin:0 0 14px">${esc(b.tagline)}</p>
      <p style="margin:0 0 14px">${links}</p>
      <p style="margin:0 0 4px">¿Dudas? Escríbenos a <a href="mailto:${esc(b.contactEmail)}" style="color:${b.accent};text-decoration:none">${esc(b.contactEmail)}</a></p>
      <p style="margin:0">${esc(b.footerNote)}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;border-top:1px solid ${b.darkLine}"><tr>
        <td style="padding-top:14px;font-size:11px;color:${b.onDarkMuted}">© ${year} ${esc(b.name)}</td>
        <td align="right" style="padding-top:14px;font-size:11px;color:${b.onDarkMuted}">${esc(b.country)}</td>
      </tr></table>
    </td></tr>

  </table>
</td></tr></table>
</body></html>`;
}
