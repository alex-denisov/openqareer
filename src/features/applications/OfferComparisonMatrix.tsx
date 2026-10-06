import { useRef } from 'react';
import {
  PencilSimple,
  X,
} from '@phosphor-icons/react';
import type { ApplicationView } from './applicationsApi';
import {
  compareOffers,
  type OfferComparisonEntry,
  type OfferTermsInput,
} from './offerCompensation';
import { useEscapeLayer } from '../shell/escapeLayers';

export interface OfferComparisonMatrixProps {
  readonly applications: readonly ApplicationView[];
  readonly onClose: () => void;
  readonly onEditOffer?: (applicationId: string) => void;
}

function formatMoney(amount: number, currency: string): string {
  const formatted = new Intl.NumberFormat('ru-RU').format(amount);
  const symbol = currency === 'RUB' ? '₽' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency;
  return `${formatted} ${symbol}`;
}

function formatWorkStyle(format?: string): string {
  if (format === 'remote') return 'Удалённо';
  if (format === 'hybrid') return 'Гибрид';
  if (format === 'office') return 'Офис';
  return format || 'Не указан';
}

function mapAppToOfferInput(app: ApplicationView): OfferTermsInput {
  const terms = app.offer?.terms;
  return {
    id: app.id,
    title: app.vacancy?.title ?? 'Без названия',
    company: app.vacancy?.companyHidden ? 'Компания скрыта' : (app.vacancy?.company ?? 'Без компании'),
    baseSalary: terms?.baseSalary ?? 0,
    salaryPeriod: terms?.salaryPeriod ?? 'month',
    bonus: terms?.bonus ?? 0,
    equity: terms?.equity,
    currency: terms?.currency ?? 'RUB',
    format: terms?.format,
    probationPeriodMonths: terms?.probationPeriodMonths,
    probationSalary: terms?.probationSalary,
    benefits: terms?.benefits ?? [],
    risks: terms?.risks ?? [],
    startDate: terms?.startDate,
    sourceNote: terms?.sourceNote ?? 'со слов кандидата',
  };
}

export function OfferComparisonMatrix({
  applications,
  onClose,
  onEditOffer,
}: OfferComparisonMatrixProps) {
  useEscapeLayer(onClose, true);
  const cardRef = useRef<HTMLDivElement>(null);

  const offersWithTerms = applications
    .filter((app) => Boolean(app.offer))
    .map(mapAppToOfferInput);

  const eligibleOffers =
    offersWithTerms.length > 0
      ? offersWithTerms
      : applications.filter((app) => app.stage === 'offer').map(mapAppToOfferInput);

  const comparison = compareOffers(eligibleOffers);

  return (
    <div
      className="career-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (!cardRef.current?.contains(e.target as Node)) onClose();
      }}
    >
      <div
        ref={cardRef}
        className="career-offer-matrix-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Сравнение офферов"
      >
        <MatrixHeader onClose={onClose} />
        <MatrixContent
          comparison={comparison}
          onEditOffer={onEditOffer}
        />
      </div>
    </div>
  );
}

function MatrixHeader({ onClose }: { readonly onClose: () => void }) {
  return (
    <header className="career-offer-matrix-header">
      <div className="career-offer-matrix-header-title">
        <h2 className="career-offer-matrix-title">Сравнение офферов</h2>
        <span className="career-offer-matrix-subtitle">
          Матрица совокупной компенсации и условий (до 4 предложений)
        </span>
      </div>
      <button
        type="button"
        className="career-btn career-btn-ghost career-btn-icon"
        aria-label="Закрыть"
        data-testid="close-matrix-btn"
        onClick={onClose}
      >
        <X size={18} />
      </button>
    </header>
  );
}

function MatrixDesktopTable({
  comparison,
  onEditOffer,
}: {
  readonly comparison: ReturnType<typeof compareOffers>;
  readonly onEditOffer?: (id: string) => void;
}) {
  return (
    <div className="career-offer-matrix-desktop-wrap">
      <table className="career-offer-matrix-table">
        <thead>
          <tr>
            <th className="career-offer-matrix-col-param">Параметр</th>
            {comparison.offers.map((item) => (
              <OfferHeaderCell
                key={item.offer.id}
                entry={item}
                isLeader={item.offer.id === comparison.highestCompensationOfferId}
                onEdit={onEditOffer}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          <TotalCompensationRow offers={comparison.offers} />
          <MonthlyAverageRow offers={comparison.offers} />
          <BaseSalaryRow offers={comparison.offers} />
          <BonusRow offers={comparison.offers} />
          <FormatRow offers={comparison.offers} />
          <ProbationRow offers={comparison.offers} />
          <BenefitsRow offers={comparison.offers} />
          <RisksRow offers={comparison.offers} />
        </tbody>
      </table>
    </div>
  );
}

function MatrixMobileStack({
  comparison,
  onEditOffer,
}: {
  readonly comparison: ReturnType<typeof compareOffers>;
  readonly onEditOffer?: (id: string) => void;
}) {
  return (
    <div className="career-offer-matrix-mobile-stack">
      {comparison.offers.map((item) => (
        <MobileOfferCard
          key={item.offer.id}
          entry={item}
          isLeader={item.offer.id === comparison.highestCompensationOfferId}
          onEdit={onEditOffer}
        />
      ))}
    </div>
  );
}

function MatrixContent({
  comparison,
  onEditOffer,
}: {
  readonly comparison: ReturnType<typeof compareOffers>;
  readonly onEditOffer?: (id: string) => void;
}) {
  if (comparison.offers.length === 0) {
    return (
      <div className="career-offer-matrix-content">
        <div className="career-offer-matrix-empty">
          Нет сохранённых условий офферов для сравнения. Откройте карточку отклика в стадии «Оффер» и заполните условия.
        </div>
      </div>
    );
  }

  return (
    <div className="career-offer-matrix-content">
      <MatrixDesktopTable comparison={comparison} onEditOffer={onEditOffer} />
      <MatrixMobileStack comparison={comparison} onEditOffer={onEditOffer} />
    </div>
  );
}

function OfferHeaderCell({
  entry,
  isLeader,
  onEdit,
}: {
  readonly entry: OfferComparisonEntry;
  readonly isLeader: boolean;
  readonly onEdit?: (id: string) => void;
}) {
  return (
    <th className={`career-offer-matrix-col-offer${isLeader ? ' is-leader' : ''}`}>
      <div className="career-offer-matrix-cell-head">
        {isLeader && (
          <span className="career-offer-matrix-badge-leader">Лидер по доходу</span>
        )}
        <div className="career-offer-matrix-company">{entry.offer.company}</div>
        <div className="career-offer-matrix-role">{entry.offer.title}</div>
        {onEdit && entry.offer.id && (
          <button
            type="button"
            className="career-btn career-btn-secondary career-btn-xs career-offer-matrix-edit-btn"
            data-testid="edit-offer-btn"
            onClick={() => onEdit(entry.offer.id!)}
          >
            <PencilSimple size={12} /> Изменить
          </button>
        )}
      </div>
    </th>
  );
}

function TotalCompensationRow({ offers }: { readonly offers: readonly OfferComparisonEntry[] }) {
  return (
    <tr className="career-offer-matrix-row-highlight">
      <td className="career-offer-matrix-param-cell">
        <strong>Совокупный доход в год</strong>
        <span className="career-offer-param-hint">Оклад + бонусы + испытательный</span>
      </td>
      {offers.map((item) => (
        <td key={item.offer.id} className="career-offer-matrix-val-cell">
          <div className="career-offer-val-bold career-mono">
            {formatMoney(item.breakdown.totalAnnualCompensation, item.breakdown.currency)}
          </div>
          <span className="career-offer-source-badge">{item.breakdown.sourceLabel}</span>
        </td>
      ))}
    </tr>
  );
}

function MonthlyAverageRow({ offers }: { readonly offers: readonly OfferComparisonEntry[] }) {
  return (
    <tr>
      <td className="career-offer-matrix-param-cell">В среднем в месяц</td>
      {offers.map((item) => (
        <td key={item.offer.id} className="career-offer-matrix-val-cell career-mono">
          {formatMoney(item.breakdown.monthlyAverage, item.breakdown.currency)}/мес.
        </td>
      ))}
    </tr>
  );
}

function BaseSalaryRow({ offers }: { readonly offers: readonly OfferComparisonEntry[] }) {
  return (
    <tr>
      <td className="career-offer-matrix-param-cell">Базовый оклад</td>
      {offers.map((item) => (
        <td key={item.offer.id} className="career-offer-matrix-val-cell career-mono">
          {formatMoney(item.offer.baseSalary ?? 0, item.breakdown.currency)}
          {item.offer.salaryPeriod === 'year' ? '/год' : '/мес.'}
        </td>
      ))}
    </tr>
  );
}

function BonusRow({ offers }: { readonly offers: readonly OfferComparisonEntry[] }) {
  return (
    <tr>
      <td className="career-offer-matrix-param-cell">Годовой бонус / премия</td>
      {offers.map((item) => (
        <td key={item.offer.id} className="career-offer-matrix-val-cell career-mono">
          {item.breakdown.annualBonus > 0
            ? `+${formatMoney(item.breakdown.annualBonus, item.breakdown.currency)}`
            : '—'}
        </td>
      ))}
    </tr>
  );
}

function FormatRow({ offers }: { readonly offers: readonly OfferComparisonEntry[] }) {
  return (
    <tr>
      <td className="career-offer-matrix-param-cell">Формат работы</td>
      {offers.map((item) => (
        <td key={item.offer.id} className="career-offer-matrix-val-cell">
          {formatWorkStyle(item.offer.format)}
        </td>
      ))}
    </tr>
  );
}

function ProbationRow({ offers }: { readonly offers: readonly OfferComparisonEntry[] }) {
  return (
    <tr>
      <td className="career-offer-matrix-param-cell">Испытательный срок</td>
      {offers.map((item) => {
        const months = item.offer.probationPeriodMonths;
        const probSal = item.offer.probationSalary;
        return (
          <td key={item.offer.id} className="career-offer-matrix-val-cell">
            {months ? (
              <div>
                <span>{months} мес.</span>
                {probSal !== undefined && (
                  <div className="career-offer-param-hint career-mono">
                    {formatMoney(probSal, item.breakdown.currency)}/мес.
                  </div>
                )}
              </div>
            ) : (
              'Стандартный / нет'
            )}
          </td>
        );
      })}
    </tr>
  );
}

function BenefitsRow({ offers }: { readonly offers: readonly OfferComparisonEntry[] }) {
  return (
    <tr>
      <td className="career-offer-matrix-param-cell">Бенефиты и льготы</td>
      {offers.map((item) => {
        const list = item.offer.benefits ?? [];
        return (
          <td key={item.offer.id} className="career-offer-matrix-val-cell">
            {list.length > 0 ? (
              <ul className="career-offer-tags-list">
                {list.map((b, idx) => (
                  <li key={idx} className="career-offer-tag career-offer-tag-benefit">
                    {b}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="career-offer-empty-field">—</span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function RisksRow({ offers }: { readonly offers: readonly OfferComparisonEntry[] }) {
  return (
    <tr>
      <td className="career-offer-matrix-param-cell">Риски и нюансы</td>
      {offers.map((item) => {
        const list = item.offer.risks ?? [];
        return (
          <td key={item.offer.id} className="career-offer-matrix-val-cell">
            {list.length > 0 ? (
              <ul className="career-offer-tags-list">
                {list.map((r, idx) => (
                  <li key={idx} className="career-offer-tag career-offer-tag-risk">
                    {r}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="career-offer-empty-field">Не зафиксированы</span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function MobileOfferCardHeader({
  company,
  title,
  id,
  isLeader,
  onEdit,
}: {
  readonly company: string;
  readonly title: string;
  readonly id?: string;
  readonly isLeader: boolean;
  readonly onEdit?: (id: string) => void;
}) {
  return (
    <div className="career-offer-mobile-header">
      <div>
        {isLeader && (
          <span className="career-offer-matrix-badge-leader">Лидер по доходу</span>
        )}
        <h3 className="career-offer-mobile-company">{company}</h3>
        <div className="career-offer-mobile-role">{title}</div>
      </div>
      {onEdit && id && (
        <button
          type="button"
          className="career-btn career-btn-secondary career-btn-xs"
          data-testid="edit-offer-btn"
          onClick={() => onEdit(id)}
        >
          <PencilSimple size={12} /> Изменить условия
        </button>
      )}
    </div>
  );
}

function MobileOfferCardGrid({
  entry,
}: {
  readonly entry: OfferComparisonEntry;
}) {
  return (
    <div className="career-offer-mobile-grid">
      <div>
        <span className="career-offer-mobile-label">В среднем в месяц</span>
        <div className="career-mono">
          {formatMoney(entry.breakdown.monthlyAverage, entry.breakdown.currency)}/мес.
        </div>
      </div>
      <div>
        <span className="career-offer-mobile-label">Базовый оклад</span>
        <div className="career-mono">
          {formatMoney(entry.offer.baseSalary ?? 0, entry.breakdown.currency)}
          {entry.offer.salaryPeriod === 'year' ? '/год' : '/мес.'}
        </div>
      </div>
      <div>
        <span className="career-offer-mobile-label">Премия / бонус</span>
        <div className="career-mono">
          {entry.breakdown.annualBonus > 0
            ? `+${formatMoney(entry.breakdown.annualBonus, entry.breakdown.currency)}`
            : 'Без бонуса'}
        </div>
      </div>
      <div>
        <span className="career-offer-mobile-label">Формат</span>
        <div>{formatWorkStyle(entry.offer.format)}</div>
      </div>
    </div>
  );
}

function MobileOfferCardTags({
  benefits,
  risks,
}: {
  readonly benefits?: readonly string[];
  readonly risks?: readonly string[];
}) {
  return (
    <>
      {benefits && benefits.length > 0 && (
        <div className="career-offer-mobile-section">
          <span className="career-offer-mobile-label">Бенефиты</span>
          <ul className="career-offer-tags-list">
            {benefits.map((b, idx) => (
              <li key={idx} className="career-offer-tag career-offer-tag-benefit">
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}
      {risks && risks.length > 0 && (
        <div className="career-offer-mobile-section">
          <span className="career-offer-mobile-label">Риски</span>
          <ul className="career-offer-tags-list">
            {risks.map((r, idx) => (
              <li key={idx} className="career-offer-tag career-offer-tag-risk">
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function MobileOfferCard({
  entry,
  isLeader,
  onEdit,
}: {
  readonly entry: OfferComparisonEntry;
  readonly isLeader: boolean;
  readonly onEdit?: (id: string) => void;
}) {
  return (
    <article className={`career-offer-mobile-card${isLeader ? ' is-leader' : ''}`}>
      <MobileOfferCardHeader
        company={entry.offer.company ?? 'Компания'}
        title={entry.offer.title ?? 'Без названия'}
        id={entry.offer.id}
        isLeader={isLeader}
        onEdit={onEdit}
      />
      <div className="career-offer-mobile-metric">
        <span className="career-offer-mobile-label">Совокупный доход в год</span>
        <div className="career-offer-val-bold career-mono">
          {formatMoney(entry.breakdown.totalAnnualCompensation, entry.breakdown.currency)}
        </div>
        <span className="career-offer-source-badge">{entry.breakdown.sourceLabel}</span>
      </div>
      <MobileOfferCardGrid entry={entry} />
      <MobileOfferCardTags benefits={entry.offer.benefits} risks={entry.offer.risks} />
    </article>
  );
}
