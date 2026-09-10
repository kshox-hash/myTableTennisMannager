import {
  S3Client,
  HeadObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Cloudflare R2 es S3-compatible: se habla con el mismo SDK de S3 apuntando
// al endpoint de la cuenta. Guardamos SOLO la URL pública en la DB; el
// archivo vive en R2 (egress gratis, no gasta ancho de banda de Render).
//
// Si faltan las env vars (ej. dev local sin R2) el cliente queda null y las
// rutas de avatar responden 503 — el resto de la app arranca igual.

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
export const R2_BUCKET = process.env.R2_BUCKET ?? "";
export const R2_PUBLIC_BASE_URL = (process.env.R2_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");

export const r2Configured =
  !!ACCOUNT_ID && !!ACCESS_KEY_ID && !!SECRET_ACCESS_KEY && !!R2_BUCKET && !!R2_PUBLIC_BASE_URL;

const client: S3Client | null = r2Configured
  ? new S3Client({
      region: "auto",
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: ACCESS_KEY_ID!,
        secretAccessKey: SECRET_ACCESS_KEY!,
      },
    })
  : null;

export function publicUrlFor(key: string): string {
  return `${R2_PUBLIC_BASE_URL}/${key}`;
}

// Cache larguísimo + immutable: la URL pública lleva ?v=<timestamp>, así
// que al reemplazar la foto cambia la URL y el navegador la vuelve a pedir;
// mientras la URL sea la misma, no revalida nunca (0 requests a R2).
const AVATAR_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** URL firmada para que el navegador haga PUT directo a R2 (expira en `expiresIn` s).
 *  El PUT solo manda Content-Type (el único header en el CORS del bucket).
 *  El Cache-Control se pone después, server-side, con setCacheControl(). */
export async function presignPutUrl(
  key: string,
  contentType: string,
  expiresIn = 300,
): Promise<string> {
  if (!client) throw new Error("R2_NOT_CONFIGURED");
  const cmd = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client, cmd, { expiresIn });
}

/** Reescribe la metadata del objeto (copy sobre sí mismo) para dejarle el
 *  Cache-Control largo — se llama al confirmar, ya del lado del server, así
 *  el navegador no necesita mandar ese header (evita tocar el CORS del bucket). */
export async function setCacheControl(key: string, contentType: string): Promise<void> {
  if (!client) throw new Error("R2_NOT_CONFIGURED");
  await client.send(
    new CopyObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      CopySource: `${R2_BUCKET}/${key}`,
      MetadataDirective: "REPLACE",
      ContentType: contentType,
      CacheControl: AVATAR_CACHE_CONTROL,
    }),
  );
}

/** Metadata del objeto (o null si no existe) — se usa para confirmar la subida
 *  y para validar tamaño/tipo del lado del server (defensa por si alguien
 *  hace un PUT directo a la URL firmada con algo que no es un avatar chico). */
export async function headObject(
  key: string,
): Promise<{ size: number; contentType: string } | null> {
  if (!client) throw new Error("R2_NOT_CONFIGURED");
  try {
    const r = await client.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return { size: r.ContentLength ?? 0, contentType: r.ContentType ?? "" };
  } catch {
    return null;
  }
}

export async function deleteObject(key: string): Promise<void> {
  if (!client) throw new Error("R2_NOT_CONFIGURED");
  await client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}
