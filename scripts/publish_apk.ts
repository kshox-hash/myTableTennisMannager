// Publica el APK de la app en el bucket R2 (descarga directa, sin Play
// Store) para que la app se actualice sola:
//
//   npx ts-node --transpile-only scripts/publish_apk.ts <ruta-al-apk> <build>
//   ej: npx ts-node --transpile-only scripts/publish_apk.ts ../../myttmi/build/app/outputs/flutter-apk/app-release.apk 75
//
// Sube dos copias: app/myttm-<build>.apk (fija, por si hay que volver atrás)
// y app/myttm.apk (siempre la última, el enlace para compartir). Al final
// imprime lo que hay que poner en Render para que las apps instaladas
// muestren "Hay una versión nueva" y se actualicen desde adentro:
//   APP_LATEST_BUILD = <build>
//   APP_UPDATE_URL   = <url de app/myttm-<build>.apk>
// (APP_MIN_BUILD solo si hay que obligar a actualizar.)
import "dotenv/config";
import { readFileSync, statSync } from "fs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

async function main() {
  const [apkPath, buildArg] = process.argv.slice(2);
  const build = Number(buildArg);
  if (!apkPath || !Number.isInteger(build) || build <= 0) {
    console.error("Uso: publish_apk.ts <ruta-al-apk> <build>");
    process.exit(1);
  }
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || !R2_PUBLIC_BASE_URL) {
    console.error("Faltan las variables R2_* en el .env");
    process.exit(1);
  }
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
  const body = readFileSync(apkPath);
  const mb = (statSync(apkPath).size / 1024 / 1024).toFixed(1);
  const base = R2_PUBLIC_BASE_URL.replace(/\/+$/, "");
  const put = (key: string, cache: string) =>
    client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: body,
        ContentType: "application/vnd.android.package-archive",
        ContentDisposition: 'attachment; filename="MyTTM.apk"',
        CacheControl: cache,
      })
    );
  const fixedKey = `app/myttm-${build}.apk`;
  console.log(`Subiendo ${mb} MB…`);
  // La de cada build no cambia nunca: se puede cachear para siempre.
  await put(fixedKey, "public, max-age=31536000, immutable");
  // "La última" cambia con cada versión: sin caché.
  await put("app/myttm.apk", "no-cache");
  console.log("\nListo.");
  console.log(`  Esta versión:     ${base}/${fixedKey}`);
  console.log(`  Siempre la última: ${base}/app/myttm.apk   (para compartir)`);
  console.log("\nEn Render (variables del backend):");
  console.log(`  APP_LATEST_BUILD = ${build}`);
  console.log(`  APP_UPDATE_URL   = ${base}/${fixedKey}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
