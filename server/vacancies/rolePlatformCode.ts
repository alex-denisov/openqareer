import { vacancySourceDisplayName } from '../../shared/vacancySourceLabel';
import { sourceKind } from './poolLiveness';

interface ClusterSource {
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sourceName?: string;
}

/**
 * B767: площадка вакансии для подписи вилки роли на s09 («hh.ru, сайты компаний»).
 * Тип транспорта `json_api` площадку не называет — кандидат видел «Открытый API».
 * Доски ATS и сайты работодателей — «сайты компаний» (макет s09), а не имя каждой компании.
 */
export function rolePlatformCode(source: ClusterSource): string {
  if (source.sourceType !== 'json_api') return source.sourceType;
  const { kind } = sourceKind(source.sourceId);
  if (kind === 'hh') return 'hh';
  if (kind === 'linkedin') return 'linkedin';
  if (kind === 'ats' || kind === 'employer_site') return 'career_site';
  const name = source.sourceName ? vacancySourceDisplayName(source.sourceName) : '';
  return name || source.sourceType;
}
