import { useEffect, useState } from 'react';
import type { B640ApplicationQuota } from '../../../../../shared/b640Vacancies';
import { Link } from '../../kit';
import { buildNodePath } from '../../routes';
import { getApplicationQuota } from '../b640Api';
import { quotaLine } from './quotaModel';

/** Остаток откликов: сбой или отсутствие лимита — строки нет, карточка работает как была. */
export function QuotaLine() {
  const [quota, setQuota] = useState<B640ApplicationQuota | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    getApplicationQuota(controller.signal)
      .then(setQuota, () => setQuota(null));
    return () => controller.abort();
  }, []);
  const line = quotaLine(quota);
  if (!line) return null;
  return (
    <p className="pm-line col-wide">
      <b className="num">{line.text}</b> · <Link to={buildNodePath('t01')}>{line.link}</Link>
    </p>
  );
}
