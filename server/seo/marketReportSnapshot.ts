/**
 * Web-server copy of `market_reports`, refreshed with the sitemap files
 * (`scheduleCatalogSitemapRefresh`). The HTTP path and llms.txt read memory only.
 */
import type { MarketReport } from '../../shared/marketReport';
import type { PublicPage } from '../../shared/publicPages';
import { publishableReports, reportPages } from './marketReport';

let reports: readonly MarketReport[] = [];

export function setMarketReports(next: readonly MarketReport[]): void {
  reports = publishableReports(next);
}

export function getMarketReports(): readonly MarketReport[] {
  return reports;
}

export function getMarketReportPages(): PublicPage[] {
  return reportPages(reports);
}

/** Test seam. */
export function resetMarketReports(): void {
  reports = [];
}
