import { pressSend } from '../apply/applyIntent';
import { Icon } from '../kit/Icon';
import { Link } from '../shell/Link';
import type { ResponseEvent } from './responseEventsModel';

function EventCard({ event, first }: { readonly event: ResponseEvent; readonly first: boolean }) {
  return (
    <li
      className={['re-card', event.failed ? 'is-err' : '', first ? 'is-next' : '']
        .filter(Boolean)
        .join(' ')}
    >
      <div className="re-main">
        <p className="re-t">
          <span className={event.failed ? 'tag miss' : 'tag part'}>{event.tag}</span>
          <Link className="re-open" to={event.openPath}>
            <b>{event.title}</b> · {event.company}
          </Link>
        </p>
        <p className="re-why">{event.why}</p>
      </div>
      <div className="actions re-acts">
        <Link className={first ? 'btn is-primary' : 'btn'} to={event.action.path} onClick={() => pressSend(event.action, event.action.path)}>
          <Icon name={event.action.icon} />
          {event.action.label}
        </Link>
      </div>
    </li>
  );
}

/**
 * B650 s05b «События откликов»: отклики, которые не дошли до компании. Событий нет — блока нет.
 * Сбой чтения блок тоже прячет: «Отклики» покажут ошибку с «Повторить», а «Сегодня» не держит
 * пустую рамку ради второстепенного блока.
 */
export function ResponseEventsBlock({
  events,
}: {
  readonly events: readonly ResponseEvent[];
}) {
  if (events.length === 0) return null;
  return (
    <section className="re-today" aria-labelledby="re-today-t">
      <h2 className="vh" id="re-today-t">
        События откликов
      </h2>
      <ul className="re-list">
        {events.map((event, index) => (
          <EventCard key={event.id} event={event} first={index === 0} />
        ))}
      </ul>
    </section>
  );
}
