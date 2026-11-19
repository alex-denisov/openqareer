import { useState } from 'react';
import { Button } from '../kit/Button';
import { StatusLine } from '../kit/ResultLine';

type Copied = 'idle' | 'ok' | 'err';

/** Копирует текст в буфер; итог копирования — строкой на месте кнопки. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CopyText({ text, label = 'Скопировать' }: { readonly text: string; readonly label?: string }) {
  const [copied, setCopied] = useState<Copied>('idle');
  return (
    <>
      <div className="actions">
        <Button icon="copy" onClick={() => void copyText(text).then((ok) => setCopied(ok ? 'ok' : 'err'))}>
          {label}
        </Button>
      </div>
      {copied === 'ok' ? <StatusLine state="ok" text="Скопировано" /> : null}
      {copied === 'err' ? <StatusLine state="err" text="Не скопировалось — выделите текст вручную" /> : null}
    </>
  );
}
