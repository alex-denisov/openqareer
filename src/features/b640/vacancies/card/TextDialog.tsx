import { useEffect, useState } from 'react';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { fetchVacancyDetail, HIDDEN_TEXT_COPY, type VacancyDetailText } from '../../../vacancies/vacancyDetailApi';
import { vacancySourceLabel } from '../../../../../shared/vacancySourceLabel';
import { Dialog, StatusLine } from '../../kit';
import { publishedLine, textBlocks } from './textBlocks';

type TextState =
  | { readonly status: 'loading' | 'failed' }
  | { readonly status: 'ready'; readonly detail: VacancyDetailText };

export interface TextDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly item: MatchedVacancyItem;
}

function useDetail(clusterId: string, open: boolean): { state: TextState; retry: () => void } {
  const [state, setState] = useState<TextState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setState({ status: 'loading' });
    fetchVacancyDetail(clusterId)
      .then((detail) => alive && setState({ status: 'ready', detail }))
      .catch(() => alive && setState({ status: 'failed' }));
    return () => {
      alive = false;
    };
  }, [clusterId, open, attempt]);
  return { state, retry: () => setAttempt((value) => value + 1) };
}

function Body({ state, item, retry }: { readonly state: TextState; readonly item: MatchedVacancyItem; readonly retry: () => void }) {
  if (state.status === 'loading') return <StatusLine state="wait" text="Загружаем текст…" />;
  if (state.status !== 'ready') {
    return (
      <StatusLine
        state="err"
        text="Не удалось загрузить текст"
        action={
          <button className="btn is-sm" type="button" onClick={retry}>
            Повторить
          </button>
        }
      />
    );
  }
  const { detail } = state;
  if (detail.textHidden) return <p className="mod-text">{HIDDEN_TEXT_COPY}</p>;
  const blocks = textBlocks(detail.description || detail.responsibilities.join('\n'));
  const source = item.cluster.sources[0];
  return (
    <>
      {blocks.map((block, index) =>
        block.kind === 'h' ? (
          <h3 className="v4-tx-h" key={index}>
            {block.text}
          </h3>
        ) : (
          <p className="mod-text" key={index}>
            {block.text}
          </p>
        ),
      )}
      {source ? (
        <p className="v4-tx-src">
          {publishedLine(vacancySourceLabel(source), source.observedAt || item.cluster.firstObservedAt)}
        </p>
      ) : null}
    </>
  );
}

/** Окно «Название · Компания» с текстом вакансии; ожидание и сбой — внутри окна. */
export function TextDialog({ open, onClose, item }: TextDialogProps) {
  const { state, retry } = useDetail(item.cluster.id, open);
  return (
    <Dialog open={open} onClose={onClose} title={`${item.cluster.canonicalTitle} · ${item.cluster.canonicalCompany}`}>
      {/* Прокручиваемый текст: фокус нужен, чтобы читать его с клавиатуры (как в макете). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className="v4-tx" tabIndex={0} role="region" aria-label="Текст вакансии">
        <Body state={state} item={item} retry={retry} />
      </div>
    </Dialog>
  );
}
