import DB from "../db/db_configuration";

export class LocationsRepository {
  async listRegions() {
    const pool = DB.getPool();
    const { rows } = await pool.query(
      `select code, name
       from cl_regions
       order by name asc`
    );
    return rows;
  }

  async listProvinces(regionCode: string) {
    const pool = DB.getPool();
    const { rows } = await pool.query(
      `select code, name, region_code
       from cl_provinces
       where region_code = $1
       order by name asc`,
      [regionCode]
    );
    return rows;
  }

  async listCommunes(provinceCode: string) {
    const pool = DB.getPool();
    const { rows } = await pool.query(
      `select code, name, province_code
       from cl_communes
       where province_code = $1
       order by name asc`,
      [provinceCode]
    );
    return rows;
  }
}
