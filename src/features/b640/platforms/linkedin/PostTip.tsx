import { InfoTip } from '../../kit';
import { useTariffQuotas } from '../../../tariffs/useTariffQuotas';

/**
 * ⓘ «О посте» у названия черновика (a03b): остаток черновиков LinkedIn за месяц.
 * Остатка нет (без тарифа, без ограничений, не прочитался) — подсказки нет.
 */
export function PostTip() {
  const summary = useTariffQuotas();
  const quota = summary?.unlimited
    ? undefined
    : summary?.quotas.find((item) => item.key === 'linkedin_drafts');
  if (!quota || quota.limit <= 0) return null;
  return (
    <InfoTip
      label="О посте"
      text={`Ваши посты: осталось ${quota.remaining} из ${quota.limit} в этом месяце.`}
    />
  );
}
