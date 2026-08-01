import { useState } from 'react';
import {
  saveGermanyMarket,
  type GermanyMarketSubmission,
  type StoredGermanyMarket,
} from './coachApi';

const DEFAULTS: GermanyMarketSubmission = {
  workAuthorization: 'unknown',
  jobOffer: 'in-progress',
  grossAnnualSalaryEur: null,
  offerDurationMonths: null,
  qualification: 'unknown',
  professionRegulation: 'unknown',
  blueCardBand: 'unknown',
  fundsMonthlyEur: null,
  languageEvidence: 'unknown',
  relocationReadiness: 'exploring',
  dependants: 'none',
  targetWorkMode: 'hybrid',
};

export function MarketStudio({
  profile,
  onSaved,
  onBack,
}: {
  profile: StoredGermanyMarket | null;
  onSaved: () => Promise<void>;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState(profile?.submission ?? DEFAULTS);
  const [editing, setEditing] = useState(!profile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      await saveGermanyMarket(draft);
      await onSaved();
      setEditing(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить маршрут.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="market-studio" aria-label="Международный рынок">
      <header className="market-hero">
        <button onClick={onBack}>← Вернуться к разговору</button>
        <p className="eyebrow">Country pack · DE-2026.1</p>
        <div>
          <h1>Германия — не фильтр. Это отдельный маршрут.</h1>
          <span aria-hidden="true">DE</span>
        </div>
        <p>Соберём ограничения, проверим возможный путь въезда и покажем, каких доказательств пока не хватает.</p>
      </header>
      {error ? <p className="market-error" role="alert">{error}</p> : null}
      {profile && !editing ? (
        <MarketResult profile={profile} onEdit={() => setEditing(true)} />
      ) : (
        <MarketForm draft={draft} onChange={setDraft} onSubmit={submit} saving={saving} />
      )}
    </section>
  );
}

function MarketForm({ draft, onChange, onSubmit, saving }: {
  draft: GermanyMarketSubmission;
  onChange: (value: GermanyMarketSubmission) => void;
  onSubmit: (event: React.FormEvent) => void;
  saving: boolean;
}) {
  const set = <K extends keyof GermanyMarketSubmission>(
    key: K,
    value: GermanyMarketSubmission[K],
  ) => onChange({ ...draft, [key]: value });
  return (
    <form className="market-form" onSubmit={onSubmit}>
      <MarketSection number="01" title="Право на работу и предложение" note="Не предполагаем sponsorship, пока его нет в оффере.">
        <Select label="Текущее право на работу" value={draft.workAuthorization} onChange={(v) => set('workAuthorization', v as GermanyMarketSubmission['workAuthorization'])} options={[
          ['unknown', 'Пока не знаю'], ['none', 'Нет'], ['eu-eea-swiss', 'Гражданство ЕС / ЕЭЗ / Швейцарии'], ['german-permit', 'Есть немецкий ВНЖ с правом работы'],
        ]} />
        <Select label="Предложение от работодателя" value={draft.jobOffer} onChange={(v) => set('jobOffer', v as GermanyMarketSubmission['jobOffer'])} options={[
          ['in-progress', 'Ищу / веду переговоры'], ['no', 'Нет, хочу искать из Германии'], ['yes', 'Есть конкретный оффер'],
        ]} />
        <NumberField label="Зарплата брутто, € / год" value={draft.grossAnnualSalaryEur} onChange={(v) => set('grossAnnualSalaryEur', v)} disabled={draft.jobOffer !== 'yes'} />
        <NumberField label="Срок оффера, месяцев" value={draft.offerDurationMonths} onChange={(v) => set('offerDurationMonths', v)} disabled={draft.jobOffer !== 'yes'} />
      </MarketSection>
      <MarketSection number="02" title="Квалификация" note="Для регулируемой профессии разрешение проверяется отдельно.">
        <Select label="Статус квалификации" value={draft.qualification} onChange={(v) => set('qualification', v as GermanyMarketSubmission['qualification'])} options={[
          ['unknown', 'Не проверял(а)'], ['recognized-comparable', 'Признана / сопоставима в Германии'], ['state-recognized-origin', 'Признана государством страны получения'], ['none', 'Нет формальной квалификации'],
        ]} />
        <Select label="Регулирование профессии" value={draft.professionRegulation} onChange={(v) => set('professionRegulation', v as GermanyMarketSubmission['professionRegulation'])} options={[
          ['unknown', 'Не знаю'], ['non-regulated', 'Не регулируется'], ['regulated-authorized', 'Регулируется, разрешение есть'], ['regulated-unresolved', 'Регулируется, разрешения пока нет'],
        ]} />
        <Select label="Порог Blue Card" value={draft.blueCardBand} onChange={(v) => set('blueCardBand', v as GermanyMarketSubmission['blueCardBand'])} options={[
          ['unknown', 'Нужно проверить категорию'], ['general', 'Общий порог'], ['reduced', 'Дефицитная профессия / новый выпускник'],
        ]} />
        <Select label="Языковое подтверждение" value={draft.languageEvidence} onChange={(v) => set('languageEvidence', v as GermanyMarketSubmission['languageEvidence'])} options={[
          ['unknown', 'Пока не проверено'], ['english-b2-plus', 'Английский B2+'], ['german-a1-plus', 'Немецкий A1+'], ['both', 'Оба'], ['below', 'Ниже этих уровней'],
        ]} />
      </MarketSection>
      <MarketSection number="03" title="Переезд и ограничения" note="Семейный контур влияет на план, но не превращается в автоматический отказ.">
        <NumberField label="Средства на проживание, € / месяц" value={draft.fundsMonthlyEur} onChange={(v) => set('fundsMonthlyEur', v)} />
        <Select label="Готовность к переезду" value={draft.relocationReadiness} onChange={(v) => set('relocationReadiness', v as GermanyMarketSubmission['relocationReadiness'])} options={[
          ['exploring', 'Изучаю условия'], ['ready', 'Готов(а) при подходящем оффере'], ['not-ready', 'Пока не готов(а)'],
        ]} />
        <Select label="Кто переезжает" value={draft.dependants} onChange={(v) => set('dependants', v as GermanyMarketSubmission['dependants'])} options={[
          ['none', 'Только я'], ['partner', 'С партнёром'], ['children', 'С детьми'], ['partner-and-children', 'С партнёром и детьми'],
        ]} />
        <Select label="Формат работы" value={draft.targetWorkMode} onChange={(v) => set('targetWorkMode', v as GermanyMarketSubmission['targetWorkMode'])} options={[
          ['hybrid', 'Гибрид'], ['onsite', 'В офисе'], ['remote-from-germany', 'Удалённо из Германии'],
        ]} />
      </MarketSection>
      <footer><p>Расчёт использует правила 2026 года и официальные источники, проверенные 1 августа 2026.</p><button className="button button--primary" disabled={saving}>{saving ? 'Проверяем…' : 'Собрать маршрут'} →</button></footer>
    </form>
  );
}

function MarketSection({ number, title, note, children }: React.PropsWithChildren<{ number: string; title: string; note: string }>) {
  return <fieldset className="market-section"><legend><span>{number}</span><div><strong>{title}</strong><small>{note}</small></div></legend><div className="market-fields">{children}</div></fieldset>;
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<readonly [string, string]> }) {
  return <label><span>{label}</span><select value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>;
}

function NumberField({ label, value, onChange, disabled = false }: { label: string; value: number | null; onChange: (value: number | null) => void; disabled?: boolean }) {
  return <label><span>{label}</span><input type="number" min="0" value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} /></label>;
}

function MarketResult({ profile, onEdit }: { profile: StoredGermanyMarket; onEdit: () => void }) {
  const recommended = profile.result.routes.find((route) => route.id === profile.result.recommendedRouteId);
  return <div className="market-result"><header><div><p className="eyebrow">Маршрут для проверки</p><h2>{recommended?.title ?? 'Сначала закрыть неизвестные'}</h2><p>{recommended?.summary ?? 'Данных пока недостаточно для приоритетного маршрута.'}</p></div><button className="button button--quiet" onClick={onEdit}>Изменить условия</button></header><div className="market-route-grid">{profile.result.routes.filter((r) => r.status !== 'not-applicable').map((route) => <article key={route.id} className={`is-${route.status}`}><div><span>{statusLabel(route.status)}</span>{route.threshold ? <small>€{route.threshold.amountEur.toLocaleString('ru-RU')} / {route.threshold.cadence === 'annual' ? 'год' : 'месяц'}</small> : null}</div><h3>{route.title}</h3><p>{route.summary}</p>{route.evidence.length ? <ul className="route-evidence">{route.evidence.map((x) => <li key={x}>✓ {x}</li>)}</ul> : null}{route.missingEvidence.length ? <><strong>Нужно проверить</strong><ul>{route.missingEvidence.map((x) => <li key={x}>{x}</li>)}</ul></> : null}<div className="route-sources">{route.sourceIds.map((id) => { const source = profile.result.sources[id]; return <a key={id} href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>; })}</div></article>)}</div><p className="market-caveat">{profile.result.caveat}</p></div>;
}

function statusLabel(status: string) {
  return ({ 'strong-signal': 'Сильный сигнал', 'possible-needs-check': 'Нужно проверить', blocked: 'Есть блокер' } as Record<string, string>)[status] ?? status;
}
