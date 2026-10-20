import { useEffect, useState } from 'react';
import { apiFetch, readDataObject } from '../coach/apiClient';

export function AdaptationAdviceContext({ turnKey }: { turnKey: string }) {
  const [state, setState] = useState<{ stale: boolean; readOnly: boolean } | null>(null);
  const [failed, setFailed] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch('/api/v1/coach/adaptation-context/' + encodeURIComponent(turnKey), { signal: controller.signal })
      .then(readDataObject<{ stale: boolean; readOnly: boolean }>).then(data => {
        if (!controller.signal.aborted) { setState(data); setFailed(false); }
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [turnKey, revision]);
  if (failed) return <p className="career-diary-note" role="status">Не удалось проверить актуальность плана. <button className="career-btn is-ghost" type="button" onClick={() => setRevision(value => value + 1)}>Повторить проверку контекста</button></p>;
  if (state?.stale) return <p className="career-diary-note" role="status">Ответ относится к предыдущему состоянию плана. Продолжите обсуждение с актуальными данными.</p>;
  if (state?.readOnly) return <p className="career-diary-note" role="status">План доступен только для чтения. Можно обсудить прошлый опыт.</p>;
  return null;
}
