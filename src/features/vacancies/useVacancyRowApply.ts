import { useState } from 'react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { openExternalLink } from '../../services/desktop/openExternalLink';
import { COLD_LETTER_CIRCLE, type RowLetterOpen } from './useVacancyLetterRoute';

/**
 * B629: «Откликнуться» opens the cold letter (circle 3); the platform and «Отклик отправлен?»
 * come after approval. Without a letter screen the old B341 path stays: the site, then a mark
 * only on confirmation.
 */
export function useVacancyRowApply(
  cluster: MatchedVacancyItem['cluster'],
  onOpenLetter?: RowLetterOpen,
) {
  const [externalOpened, setExternalOpened] = useState(false);
  const handleApply = () => {
    if (onOpenLetter) {
      onOpenLetter(cluster, COLD_LETTER_CIRCLE);
      return;
    }
    void openExternalLink(cluster.primaryUrl);
    setExternalOpened(true);
  };
  return { externalOpened, applyOpensLetter: Boolean(onOpenLetter), handleApply };
}
