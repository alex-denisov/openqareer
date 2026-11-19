import type { LinkedinDraft } from '../../../today/linkedinDraftApi';
import { draftDate, draftTag } from './linkedinModel';

/** Строка поста в списке постов: тема, дата, метка состояния. */
export function PublicationRow({ draft }: { readonly draft: LinkedinDraft }) {
  const base = draftTag(draft.status);
  const tag = draft.status === 'draft' ? { ...base, label: 'черновик готов' } : base;
  const date = draftDate(draft);
  return (
    <li className="row lk-post">
      <div>
        <div className="row-title">{draft.topic}</div>
        {date ? <div className="row-sub num">{`Опубликован ${date}`}</div> : null}
      </div>
      <span className={tag.className}>{tag.label}</span>
    </li>
  );
}
