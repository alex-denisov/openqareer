import { useEffect, useState } from 'react';
import type { CareerDiaryPeopleMap } from '../../../../shared/careerDiaryPeople';
import { getPeople } from '../adaptation/adaptationApi';
import { personName } from '../adaptation/PeopleDialogs';
import { Icon } from '../kit/Icon';
import { buildNodePath } from '../routes';
import { Link } from '../shell/Link';
import { getOverview } from './diaryApi';
import { longDate } from './goalsModel';
import { today } from './model';

/** Ближайшая встреча с карты людей текущего места работы; её нет или карта не прочиталась — null. */
function useNextMeeting(): CareerDiaryPeopleMap | null {
  const [map, setMap] = useState<CareerDiaryPeopleMap | null>(null);
  useEffect(() => {
    let active = true;
    getOverview()
      .then((overview) => {
        const workplace = overview.primaryWorkplace;
        return workplace ? getPeople(workplace.id) : null;
      })
      .then(
        (found) => active && setMap(found),
        // Блок вспомогательный: без карты людей экран целей работает как прежде.
        () => active && setMap(null),
      );
    return () => {
      active = false;
    };
  }, []);
  return map;
}

/** Заголовок блока: «14 января — Цели года» или «14 января — встреча: Анна». */
export function meetingTitle(map: CareerDiaryPeopleMap, now: string): string | null {
  const next = map.nextMeeting;
  if (!next) return null;
  const person = map.groups.flatMap((group) => group.people).find((p) => p.id === next.personId);
  const what = next.topic ?? (person ? `встреча: ${personName(person)}` : 'встреча');
  return `${longDate(next.date, now)} — ${what}`;
}

/** d02, правая колонка: ближайшая встреча и «Подготовить встречу» (B742). */
export function GoalsMeeting() {
  const map = useNextMeeting();
  const title = map ? meetingTitle(map, today()) : null;
  if (!title) return null;
  return (
    <section className="mod" aria-labelledby="kp-meet">
      <h3 className="mod-title" id="kp-meet">
        {title}
      </h3>
      <div className="actions">
        <Link className="btn is-quiet" to={buildNodePath('d01c')}>
          <Icon name="calendar" />
          Подготовить встречу
        </Link>
      </div>
    </section>
  );
}
