import {
  CaretRight,
  EnvelopeSimple,
  FileText,
  UserCircle,
  UserFocus,
  UsersThree,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { pluralRu } from '../../../shared/pluralRu';
import type { CompanyPathActions } from './VacancyCompanyPathPanel';
import type { ConnectionCirclePath, VacancyConnectionCircles } from './vacancyLetterApi';
import { pathCircleCards, pathSourceNote, type PathCircleCard } from './vacancyPathCircles';
import type { VacancyPathCirclesState } from './useVacancyPathCircles';

export type CirclePage = 'c1' | 'c2' | 'c3';

const CIRCLE_ICONS = { 1: UserFocus, 2: UsersThree, 3: EnvelopeSimple } as const;

export function PushHero({
  title,
  subtitle,
}: {
  readonly title: string;
  readonly subtitle: string;
}) {
  return (
    <div className="vacancy-push-hero">
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </div>
  );
}

export function PushRow({
  icon,
  title,
  lines = [],
  onClick,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly lines?: readonly string[];
  readonly onClick?: () => void;
}) {
  const body = (
    <>
      <span className="vacancy-push-ico">{icon}</span>
      <span className="vacancy-push-main">
        <b>{title}</b>
        {lines.map((line) => (
          <small key={line}>{line}</small>
        ))}
      </span>
    </>
  );
  if (!onClick) return <div className="vacancy-push-row">{body}</div>;
  return (
    <button type="button" className="vacancy-push-row" onClick={onClick}>
      {body}
      <CaretRight className="vacancy-push-chev" aria-hidden="true" />
    </button>
  );
}

/** B446-g4: пока круги грузятся или не загрузились, холодное письмо (круг 3) доступно. */
function ColdLetterLink({ onPrepareLetter }: { readonly onPrepareLetter?: () => void }) {
  if (!onPrepareLetter) return null;
  return (
    <button type="button" className="vacancy-push-text" onClick={onPrepareLetter}>
      Подготовить письмо
    </button>
  );
}

export function PushCirclesStatus({
  state,
  onPrepareLetter,
}: {
  readonly state: VacancyPathCirclesState;
  readonly onPrepareLetter?: () => void;
}) {
  if (state.status === 'loading') {
    return (
      <div className="vacancy-push-foot">
        <p role="status">Загружаем связи с компанией…</p>
        <ColdLetterLink onPrepareLetter={onPrepareLetter} />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="vacancy-push-foot" role="alert">
        <p>Не удалось загрузить связи с компанией.</p>
        <button type="button" className="vacancy-push-text" onClick={state.retry}>
          Повторить
        </button>
        <ColdLetterLink onPrepareLetter={onPrepareLetter} />
      </div>
    );
  }
  return null;
}

function CircleLink({
  card,
  onOpen,
}: {
  readonly card: PathCircleCard;
  readonly onOpen?: () => void;
}) {
  const Icon = CIRCLE_ICONS[card.circle];
  return (
    <button type="button" className="vacancy-push-circle" onClick={onOpen} disabled={!onOpen}>
      <small>
        <Icon size={14} aria-hidden="true" />
        {card.label}
      </small>
      <b>{card.title}</b>
      <p>{card.summary}</p>
      <span className="vacancy-push-go">
        {card.actionLabel}
        <CaretRight size={14} aria-hidden="true" />
      </span>
    </button>
  );
}

export function PushPathPage({
  data,
  actions,
  onOpenCircle,
}: {
  readonly data: VacancyConnectionCircles;
  readonly actions: CompanyPathActions;
  readonly onOpenCircle: (page: CirclePage) => void;
}) {
  return (
    <>
      <PushHero title="Как откликнуться" subtitle={`${data.companyName} · три круга связей`} />
      {pathCircleCards(data).map((card) => (
        <CircleLink
          key={card.circle}
          card={card}
          onOpen={card.known ? () => onOpenCircle(`c${card.circle}`) : actions.onShowPaths}
        />
      ))}
      <p className="vacancy-push-foot">{pathSourceNote(data)} Шанс ответа не показываем.</p>
    </>
  );
}

function personLines(path: ConnectionCirclePath): readonly string[] {
  return [path.recipient.roleTitle, path.evidence[0]].filter((line): line is string =>
    Boolean(line),
  );
}

function circlePaths(data: VacancyConnectionCircles, circle: 1 | 2) {
  const result = data.circles.find((item) => item.circle === circle);
  return result?.state === 'available' ? result.paths : [];
}

function CircleOnePage({ data }: { readonly data: VacancyConnectionCircles }) {
  const paths = circlePaths(data, 1);
  return (
    <>
      <PushHero title="Знакомый в компании" subtitle={`${data.companyName} · круг 1`} />
      <section className="vacancy-push-group">
        <h3 className="vacancy-push-cap">Контакты в компании</h3>
        <div className="vacancy-push-list">
          {paths.map((path) => (
            <PushRow
              key={path.id}
              icon={<UserCircle aria-hidden="true" />}
              title={path.recipient.fullName}
              lines={personLines(path)}
            />
          ))}
        </div>
        <p className="vacancy-push-foot">
          Черновик сообщения готовит консультант. Ничего не отправится без вашего одобрения.
        </p>
      </section>
    </>
  );
}

function CircleTwoPage({ data }: { readonly data: VacancyConnectionCircles }) {
  const paths = circlePaths(data, 2);
  return (
    <>
      <PushHero
        title="Через знакомого"
        subtitle={`${data.companyName} · круг 2 · ${pluralRu(paths.length, ['путь', 'пути', 'путей'])}`}
      />
      <section className="vacancy-push-group">
        <h3 className="vacancy-push-cap">Пути через знакомых</h3>
        <div className="vacancy-push-list">
          {paths.map((path) => (
            <div className="vacancy-push-chain" key={path.id}>
              <span>
                <b>Вы</b>
              </span>
              {[...path.path, path.recipient].map((person) => (
                <span key={person.id}>
                  <b>{person.fullName}</b>
                  {person.roleTitle ? <small>{person.roleTitle}</small> : null}
                </span>
              ))}
            </div>
          ))}
        </div>
        <p className="vacancy-push-foot">{pathSourceNote(data)}</p>
      </section>
    </>
  );
}

function CircleThreePage({ data }: { readonly data: VacancyConnectionCircles }) {
  return (
    <>
      <PushHero title="Холодный отклик" subtitle={`${data.companyName} · круг 3`} />
      <section className="vacancy-push-group">
        <h3 className="vacancy-push-cap">Что отправится</h3>
        <div className="vacancy-push-list">
          <PushRow icon={<FileText aria-hidden="true" />} title="Резюме под вакансию" />
          <PushRow
            icon={<EnvelopeSimple aria-hidden="true" />}
            title="Сопроводительное письмо"
            lines={['Черновик, ждёт вашего одобрения']}
          />
        </div>
      </section>
    </>
  );
}

export function PushCirclePage({
  page,
  data,
}: {
  readonly page: CirclePage;
  readonly data: VacancyConnectionCircles;
}) {
  if (page === 'c1') return <CircleOnePage data={data} />;
  if (page === 'c2') return <CircleTwoPage data={data} />;
  return <CircleThreePage data={data} />;
}

export const CIRCLE_CTA: Record<
  CirclePage,
  { readonly label: string; readonly action: keyof CompanyPathActions }
> = {
  c1: { label: 'Написать знакомому', action: 'onWriteContact' },
  c2: { label: 'Попросить представить', action: 'onPrepareLetter' },
  c3: { label: 'Подготовить письмо', action: 'onPrepareLetter' },
};
