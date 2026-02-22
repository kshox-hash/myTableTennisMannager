// src/scripts/sync_chile_locations.ts
import DB from "../db/db_configuration";
import type { PoolClient } from "pg";

type Region = { codigo: string; nombre: string };

// ✅ DPA suele traer "codigo_padre" (no "codigoRegion")
type Province = { codigo: string; nombre: string; codigo_padre?: string };
type Commune = { codigo: string; nombre: string; codigo_padre?: string };

const BASE = "https://apis.digital.gob.cl/dpa";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} en ${url}\n${txt}`);
  }

  return (await res.json()) as T;
}

async function upsertRegion(client: PoolClient, r: Region) {
  await client.query(
    `
    insert into cl_regions(code, name)
    values ($1, $2)
    on conflict (code) do update set
      name = excluded.name
    `,
    [r.codigo, r.nombre]
  );
}

async function upsertProvince(client: PoolClient, p: Province, fallbackRegionCode: string) {
  const regionCode = (p.codigo_padre ?? fallbackRegionCode ?? "").toString().trim();
  if (!regionCode) {
    throw new Error(`Provincia ${p.codigo} (${p.nombre}) sin region padre (codigo_padre)`);
  }

  await client.query(
    `
    insert into cl_provinces(code, name, region_code)
    values ($1, $2, $3)
    on conflict (code) do update set
      name = excluded.name,
      region_code = excluded.region_code
    `,
    [p.codigo, p.nombre, regionCode]
  );
}

async function upsertCommune(client: PoolClient, c: Commune, fallbackProvinceCode: string) {
  const provinceCode = (c.codigo_padre ?? fallbackProvinceCode ?? "").toString().trim();
  if (!provinceCode) {
    throw new Error(`Comuna ${c.codigo} (${c.nombre}) sin provincia padre (codigo_padre)`);
  }

  await client.query(
    `
    insert into cl_communes(code, name, province_code)
    values ($1, $2, $3)
    on conflict (code) do update set
      name = excluded.name,
      province_code = excluded.province_code
    `,
    [c.codigo, c.nombre, provinceCode]
  );
}

async function main() {
  console.log("📍 Sync Chile Locations (DPA -> Postgres)");
  console.log("🔗 Base:", BASE);

  const regions = await getJson<Region[]>(`${BASE}/regiones`);
  console.log(`✅ Regiones: ${regions.length}`);

  let provincesCount = 0;
  let communesCount = 0;

  await DB.withTransaction(async (client) => {
    for (const r of regions) {
      await upsertRegion(client, r);

      const provinces = await getJson<Province[]>(
        `${BASE}/regiones/${encodeURIComponent(r.codigo)}/provincias`
      );
      provincesCount += provinces.length;

      for (const p of provinces) {
        // ✅ region_code viene como codigo_padre, si no, usamos r.codigo
        await upsertProvince(client, p, r.codigo);

        const communes = await getJson<Commune[]>(
          `${BASE}/provincias/${encodeURIComponent(p.codigo)}/comunas`
        );
        communesCount += communes.length;

        for (const c of communes) {
          // ✅ province_code viene como codigo_padre, si no, usamos p.codigo
          await upsertCommune(client, c, p.codigo);
        }
      }
    }
  });

  console.log("✅ Sync terminado");
  console.log("📦 Provincias:", provincesCount);
  console.log("🏘️ Comunas:", communesCount);
}

main().catch((e) => {
  console.error("❌ Sync falló:", e);
  process.exit(1);
});

