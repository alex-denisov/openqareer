import type { LinkedinDraft } from '../../../today/linkedinDraftApi';
import { formatSlotOn } from '../format';
import { draftDate, draftTag } from './linkedinModel';

/** Строка поста в списке постов: тема, дата, метка состояния. */
export function PublicationRow({
  draft,
  slot,
}: {
  readonly draft: LinkedinDraft;
  readonly slot?: string;
}) {
  const base = draftTag(draft.status);
  const tag = draft.status === 'draft' ? { ...base, label: 'черновик готов' } : base;
  const date = draftDate(draft);
  const planned = formatSlotOn(slot);
  return (
    <li className="row lk-post">
      <div>
        <div className="row-title">{draft.topic}</div>
        {planned ? <div className="row-sub num">{`Опубликуем ${planned}`}</div> : null}
        {date ? <div className="row-sub num">{`Опубликован ${date}`}</div> : null}
      </div>
      <span className={tag.className}>{tag.label}</span>
    </li>
  );
}
