import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { Icon, Link } from '../../kit';
import { rowFormat, rowGeo } from '../format';
import { SaveButton, type SaveButtonProps } from './SaveButton';

export interface HeadProps {
  readonly item: MatchedVacancyItem;
  readonly companyPath: string;
  readonly save: Omit<SaveButtonProps, 'mobile'> | null;
}

const LONG_TITLE = 40;

/** Шапка: компания, «Город · формат», название и «Сохранить» (на 390 — в углу шапки). */
export function Head({ item, companyPath, save }: HeadProps) {
  const { cluster } = item;
  const sub = [rowGeo(item), rowFormat(item)].filter(Boolean).join(' · ');
  return (
    <section className="lead vd-lead v4-head" aria-labelledby="vc-title">
      <p className="v4-coname">
        <Link className="v4-co-a" to={companyPath}>
          <Icon name="building" />
          {cluster.canonicalCompany}
        </Link>
      </p>
      <p className="v4-co-sub">{sub}</p>
      <h2 className={cluster.canonicalTitle.length > LONG_TITLE ? 'lead-title is-long' : 'lead-title'} id="vc-title">
        {cluster.canonicalTitle}
      </h2>
      {save ? <SaveButton {...save} mobile /> : null}
    </section>
  );
}
