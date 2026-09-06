import type {
  BuildinRuAbroadRaw,
  DriveCompanyRaw,
  NotionRelocationRaw,
  TelegraphCurrencyRemoteRaw,
} from "./companyListIngestion";
import seeds from "./companySeeds.json";

export const NOTION_RELOCATION_SEEDS: readonly NotionRelocationRaw[] =
  seeds.notion as unknown as readonly NotionRelocationRaw[];

export const TELEGRAPH_CURRENCY_REMOTE_SEEDS: readonly TelegraphCurrencyRemoteRaw[] =
  seeds.telegraph as unknown as readonly TelegraphCurrencyRemoteRaw[];

export const BUILDIN_RU_ABROAD_SEEDS: readonly BuildinRuAbroadRaw[] =
  seeds.buildin as unknown as readonly BuildinRuAbroadRaw[];

export const DRIVE_COMPANIES_SEEDS: readonly DriveCompanyRaw[] =
  seeds.drive as unknown as readonly DriveCompanyRaw[];
