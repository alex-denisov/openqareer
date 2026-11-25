import { useState } from 'react';
import { useAction } from '../../account/consentParts';
import { Button, StatusLine } from '../../kit';

/** Повтор неподтверждённого отклика: только после слов кандидата, что он не ушёл. */
export function AtsAgain({ onAgain }: { readonly onAgain: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const { busy, failed, run } = useAction(() => setAsking(false));
  if (!asking) {
    return (
      <div className="actions">
        <Button icon="send" onClick={() => setAsking(true)}>
          Отправить снова
        </Button>
      </div>
    );
  }
  return (
    <>
      <StatusLine state="wait" text="Отклик точно не ушёл?" />
      <div className="actions">
        <Button variant="primary" busy={busy} onClick={() => run(onAgain)}>
          Не ушёл
        </Button>
        <Button variant="quiet" disabled={busy} onClick={() => setAsking(false)}>
          Отмена
        </Button>
      </div>
      {failed ? <StatusLine state="err" text="Не получилось. Повторите." /> : null}
    </>
  );
}
