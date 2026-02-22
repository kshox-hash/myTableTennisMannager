import { LocationsRepository } from "./locations_repository";

export class LocationsService {
  private repo = new LocationsRepository();

  listRegions() {
    return this.repo.listRegions();
  }

  listProvinces(regionCode: string) {
    return this.repo.listProvinces(regionCode);
  }

  listCommunes(provinceCode: string) {
    return this.repo.listCommunes(provinceCode);
  }
}
