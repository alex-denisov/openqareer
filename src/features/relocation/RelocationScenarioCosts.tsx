import { RelocationDateInput } from './RelocationFormControls';
import type { RelocationCost } from '../../../shared/relocationScenario';
export const EXPENSE_LABELS = { rent: 'Жильё', utilities: 'Коммунальные услуги', food: 'Питание', transport: 'Транспорт', insurance: 'Дополнительная страховка', education: 'Образование и дети', other: 'Другие обязательства' };
export const UPFRONT_LABELS = { visa: 'Виза и разрешения', moving: 'Переезд', deposit: 'Возвратный депозит', documents: 'Документы и переводы', travel: 'Дорога', furnishings: 'Обустройство' };
export function ScenarioCostField({ label, currency, once = false, hidePayer = false, value, onChange }: {
  readonly label: string; readonly currency: string; readonly once?: boolean; readonly hidePayer?: boolean;
  readonly value: RelocationCost | undefined; readonly onChange: (cost: RelocationCost | undefined) => void;
}) {
  const update = (patch: Partial<RelocationCost>) => value && onChange({ ...value, ...patch });
  return <details className="career-relocation-scenario-cost">
    <summary>{label}: {value ? `${value.amount} ${value.currency} · ${value.payer === 'candidate' ? value.period === 'annual' ? 'в год' : once ? 'однократно' : 'в месяц' : 'покрыто отдельно'}` : 'не указано'}</summary>
    <div className="career-relocation-economy-controls">
      <label><span>{label}, {currency}</span><input type="number" min="0" step="any" value={value?.amount ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : { currency, period: once ? 'once' : 'monthly', payer: 'candidate', kind: 'candidate_estimate', basis: 'Личная оценка кандидата', observedAt: new Date().toISOString().slice(0, 10), ...value, ...{ amount: Number(e.target.value) } })} /></label>
      {!once && <label><span>Период: {label}</span><select disabled={!value} value={value?.period ?? 'monthly'} onChange={(e) => update({ period: e.target.value === 'annual' ? 'annual' : 'monthly' })}><option value="monthly">В месяц</option><option value="annual">В год</option></select></label>}
      {!hidePayer && <label><span>Кто оплачивает: {label}</span><select disabled={!value} value={value?.payer ?? 'candidate'} onChange={(e) => update({ payer: e.target.value as RelocationCost['payer'] })}><option value="candidate">Я</option><option value="employer">Работодатель</option><option value="included">Уже включено в другую сумму</option></select></label>}
      <label><span>Основание: {label}</span><select disabled={!value} value={value?.kind ?? 'candidate_estimate'} onChange={(e) => update({ kind: e.target.value === 'source_quote' ? 'source_quote' : 'candidate_estimate' })}><option value="candidate_estimate">Моя оценка</option><option value="source_quote">Объявление или документ</option></select></label>
      <label><span>Описание источника: {label}</span><input disabled={!value} maxLength={500} value={value?.basis ?? ''} onChange={(e) => update({ basis: e.target.value })} /></label>
      <label><span>Дата: {label}</span><RelocationDateInput disabled={!value} value={value?.observedAt ?? ''} onChange={(e) => update({ observedAt: e.target.value })} /></label>
      <label><span>Ссылка: {label}</span><input disabled={!value} type="url" placeholder="https://" value={value?.url ?? ''} onChange={(e) => update({ url: e.target.value || undefined })} /></label>
    </div>
  </details>;
}
