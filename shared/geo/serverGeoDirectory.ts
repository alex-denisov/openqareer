import data from './geoDirectory.json';
import { type GeoDirectoryData, isGeoDirectoryReady, registerGeoDirectory } from './geoDirectory';

/** Сервер и тесты: справочник в памяти сразу при импорте, без отдельного чанка. */
export function registerServerGeoDirectory(): void {
  if (!isGeoDirectoryReady()) registerGeoDirectory(data as GeoDirectoryData);
}

registerServerGeoDirectory();
