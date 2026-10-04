import {
  DEFAULT_APPLICATION_ARCHIVE_STALE_DAYS,
  type ApplicationArchiveReason,
} from '../../../shared/applicationArchive';
import { pluralRu } from '../../../shared/pluralRu';

export function archiveReasonLabel(
  reason: ApplicationArchiveReason | null | undefined,
  staleDays?: number,
): string {
  switch (reason ?? 'unknown') {
    case 'candidate':
      return 'Вы перенесли в архив';
    case 'vacancy_closed':
      return 'Вакансия закрыта';
    case 'stale': {
      const days = Number.isInteger(staleDays) && staleDays && staleDays > 0
        ? staleDays
        : DEFAULT_APPLICATION_ARCHIVE_STALE_DAYS;
      return `Нет движения ${pluralRu(days, ['день', 'дня', 'дней'])}`;
    }
    case 'unknown':
      return 'Причина не записана';
  }
}
