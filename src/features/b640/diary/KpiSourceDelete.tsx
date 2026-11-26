import { useState } from 'react';
import type { CareerDiaryKpiImport } from '../../../../shared/careerDiaryKpi';
import { Button } from '../kit/Button';
import { Dialog } from '../kit/Dialog';
import { StatusLine } from '../kit/ResultLine';
import { deleteKpiSource } from './diaryApi';

const WHAT = { text: 'текст', table: 'файл', photo: 'фото' } as const;

/** Удаление загруженного исходника по запросу кандидата; черновик и цели остаются. */
export function KpiSourceDelete({ draft }: { readonly draft: CareerDiaryKpiImport }) {
  const [stored, setStored] = useState(draft.sourceStored);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const what = WHAT[draft.sourceKind];
  if (!stored) return <StatusLine state="ok" text={`Загруженный ${what} удалён`} />;
  async function remove() {
    setBusy(true);
    setFailed(false);
    try {
      await deleteKpiSource(draft.id);
      setStored(false);
      setOpen(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  const footer = (
    <>
      <Button variant="primary" icon="trash" busy={busy} onClick={() => void remove()}>
        Удалить
      </Button>
      <Button onClick={() => setOpen(false)}>Отмена</Button>
    </>
  );
  return (
    <>
      <p className="kd-file">
        <button className="row-act" type="button" onClick={() => setOpen(true)}>
          {`Удалить загруженный ${what}`}
        </button>
      </p>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Удалить загруженный ${what}?`}
        footer={footer}
      >
        <p>Строки на проверке и принятые цели останутся.</p>
        {failed ? <StatusLine state="err" text="Не удалилось" /> : null}
      </Dialog>
    </>
  );
}
