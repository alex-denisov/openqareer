import type { CandidateMemory } from '../../coach/coachApi';
import { provenanceLabel } from '../../resume/profileProvenance';
import { Icon } from '../kit/Icon';
import { Link } from '../shell/Link';
import { actionLink, linkedRecords, type ConsultantReplyExtras } from './replyModel';

export interface ReplyExtrasProps {
  readonly extras: ConsultantReplyExtras;
  readonly memory: readonly CandidateMemory[];
}

/**
 * K1: под ответом консультанта — записи профиля, на которые он опирается, с источником,
 * и шаги в разделы кабинета. Первое действие обычное, остальные тихие.
 */
export function ReplyExtras({ extras, memory }: ReplyExtrasProps) {
  const records = linkedRecords(extras, memory);
  if (records.length === 0 && extras.actions.length === 0) return null;
  return (
    <>
      {records.map((record) => (
        <div className="ref" key={record.id}>
          <b>{record.statement}</b>
          <span className="from">
            <Icon name="file" />
            {provenanceLabel(record.provenance)}
          </span>
        </div>
      ))}
      {extras.actions.length > 0 ? (
        <div className="msg-acts">
          {extras.actions.map((action, index) => {
            const link = actionLink(action);
            return (
              <Link
                key={action}
                className={`btn is-sm${index === 0 ? '' : ' is-quiet'}`}
                to={link.to}
              >
                <Icon name={link.icon} />
                {link.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
