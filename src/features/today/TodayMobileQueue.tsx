import { useState } from 'react';
import {
  Bell,
  BookmarkSimple,
  Briefcase,
  CaretRight,
  ChatsCircle,
  LinkedinLogo,
  PaperPlaneTilt,
} from '@phosphor-icons/react';
import type { CareerCabinetView } from '../cabinet/cabinetViews';
import type { NavigationOptions } from '../shell/pathIndicator';
import type { TodayFollowUp, TodayQueueItem, TodaySnapshot } from './todayApi';
import { formatQueueTitle, queueKey, queueMobileSubtitle, queueMobileTitle } from './todayFormat';
import { useCanOpenQueueItem, useOpenQueueItem } from './todayQueueOpen';

export interface TodayQueueRemainderProps {
  readonly loading?: boolean;
  readonly failed?: boolean;
  readonly onLoad?: () => Promise<void>;
}

function TodayMobileQueueMore({
  remaining,
  remainder,
  onShow,
}: {
  readonly remaining: number;
  readonly remainder: TodayQueueRemainderProps;
  readonly onShow: () => Promise<void>;
}) {
  return (
    <>
      {remaining > 0 ? (
        <button
          type="button"
          className="career-btn career-btn-secondary career-btn-sm pm-queue-more"
          data-testid="today-mobile-queue-more"
          disabled={remainder.loading}
          onClick={() => void onShow()}
        >
          {remainder.loading ? 'Загружаем…' : `Показать остальные ${remaining}`}
        </button>
      ) : null}
      {remainder.failed ? (
        <p role="alert">Не удалось загрузить остальные карточки очереди.</p>
      ) : null}
    </>
  );
}

const MOBILE_QUEUE_FOLD = 4;

// Макет 1 «Много: очередь больше пяти»: на 390 видны первые четыре строки, остальные — по кнопке.
export function TodayMobileQueue({
  snapshot,
  onNavigate,
  remainder,
}: {
  readonly snapshot: Pick<TodaySnapshot, 'queue' | 'queueTotal' | 'followUps'>;
  readonly onNavigate?: (view: CareerCabinetView, options?: NavigationOptions) => void;
  readonly remainder: TodayQueueRemainderProps;
}) {
  const { queue, followUps } = snapshot;
  const queueTotal = snapshot.queueTotal ?? queue.length;
  const [expanded, setExpanded] = useState(false);
  const visibleQueue = expanded ? queue : queue.slice(0, MOBILE_QUEUE_FOLD);
  const remaining = Math.max(queueTotal, queue.length) - visibleQueue.length;
  const showRest = async () => {
    if (queue.length <= visibleQueue.length && remainder.onLoad) await remainder.onLoad();
    setExpanded(true);
  };
  return (
    <section className="pm-group" aria-label="Очередь дня">
      <h3 className="pm-cap">Очередь дня</h3>
      {visibleQueue.length ? (
        <ul className="pm-list">
          {visibleQueue.map((item) => (
            <TodayMobileQueueRow
              key={queueKey(item)}
              item={item}
              followUps={followUps}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      ) : (
        <p className="pm-empty">Очередь дня пуста. Новые задачи появятся здесь.</p>
      )}
      <TodayMobileQueueMore remaining={remaining} remainder={remainder} onShow={showRest} />
      <p className="pm-foot">Только то, у чего есть срок или что ждёт вашего ответа.</p>
    </section>
  );
}

function TodayMobileQueueRow({
  item,
  followUps,
  onNavigate,
}: {
  readonly item: TodayQueueItem;
  readonly followUps: readonly TodayFollowUp[];
  readonly onNavigate?: (view: CareerCabinetView, options?: NavigationOptions) => void;
}) {
  const isWarn = isOverdueMobileQueueItem(item, followUps);
  const openItem = useOpenQueueItem(onNavigate);
  const canOpen = useCanOpenQueueItem(item, onNavigate);
  return (
    <li>
      <button
        className={`pm-row${isWarn ? ' is-warn' : ''}`}
        type="button"
        aria-label={`Открыть: ${formatQueueTitle(item.company, item.title)}`}
        data-testid="today-mobile-queue-row"
        disabled={!canOpen}
        onClick={() => openItem?.(item)}
      >
        <span className="pm-ico">
          <TodayMobileQueueIcon item={item} />
        </span>
        <span className="pm-main">
          <b>{queueMobileTitle(item)}</b>
          <small>{queueMobileSubtitle(item, isWarn)}</small>
        </span>
        <CaretRight className="pm-chev" aria-hidden="true" weight="regular" />
      </button>
    </li>
  );
}

function isOverdueMobileQueueItem(
  item: TodayQueueItem,
  followUps: readonly TodayFollowUp[],
): boolean {
  const followUp = followUps.find((entry) => entry.applicationId === item.applicationId);
  if (followUp) return followUp.status === 'overdue';
  const dueAt = item.dueAt ? Date.parse(item.dueAt) : Number.NaN;
  return Number.isFinite(dueAt) && dueAt < Date.now();
}

function TodayMobileQueueIcon({ item }: { readonly item: TodayQueueItem }) {
  if (item.kind === 'linkedin_post') {
    return <LinkedinLogo aria-hidden="true" weight="regular" />;
  }
  if (item.kind === 'follow_up') return <Bell aria-hidden="true" weight="regular" />;
  if (item.kind === 'interview') return <ChatsCircle aria-hidden="true" weight="regular" />;
  if (item.kind === 'candidate_turn') return <PaperPlaneTilt aria-hidden="true" weight="regular" />;
  if (item.kind === 'shortlist') return <BookmarkSimple aria-hidden="true" weight="regular" />;
  return <Briefcase aria-hidden="true" weight="regular" />;
}
