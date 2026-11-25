import { useState } from 'react';
import { Button, Icon, Link } from '../../kit';
import { buildNodePath } from '../../routes';
import { postsCount } from './linkedinModel';
import { commentsToday } from './rhythmModel';
import type { CommentPlan } from './useCommentPlan';

/** «Изменить темы»: темы берутся из записей опыта профиля (mechanics.md, п. 61–63; решение 23.11). */
export const TOPICS_PATH = `${buildNodePath('s01')}#sec-exp`;

export function TopicsLink() {
  return (
    <Link className="btn is-primary" to={TOPICS_PATH}>
      <Icon name="sliders" />
      Изменить темы
    </Link>
  );
}

function TopicsMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="lk-menu">
      <button
        className="icon-btn"
        type="button"
        aria-label="Ещё действия: комментарии"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="more" />
      </button>
      <ul className="lk-menu-l" role="menu" hidden={!open}>
        <li role="none">
          <Link role="menuitem" to={TOPICS_PATH}>
            Изменить темы
          </Link>
        </li>
      </ul>
    </div>
  );
}

interface FeedHeadProps {
  readonly count: number;
  readonly plan: CommentPlan | null;
  readonly open: readonly string[];
  readonly busy: boolean;
  readonly onApproveAll: () => void;
}

/** a05: «3 поста · Сегодня осталось 1 из 2» и меню «…» с «Изменить темы». */
export function FeedHead({ count, plan, open, busy, onApproveAll }: FeedHeadProps) {
  const today = plan
    ? commentsToday(plan.rhythm.comments, plan.rhythm.timezone, plan.items, Date.now())
    : null;
  const title = today
    ? `${postsCount(count)} · Сегодня осталось ${today.left} из ${today.total}`
    : postsCount(count);
  return (
    <div className="list-head">
      <h2 id="cm-title">{title}</h2>
      {open.length > 1 ? (
        <Button size="sm" icon="check" busy={busy} onClick={onApproveAll}>
          {`Одобрить все · ${Math.min(open.length, 20)}`}
        </Button>
      ) : null}
      <TopicsMenu />
    </div>
  );
}
