import { useEffect, useRef, useState } from 'react';
import { Icon, useToast } from '../../kit';

const DONE_MS = 2000;

async function writeText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** «Скопировать»: значок меняется на галочку на 2 с, подтверждение — тостом; на площадку ничего не уходит. */
export function CopyButton({ text, label, caption, className = 'icon-btn li-copy' }: {
  readonly text: string;
  readonly label: string;
  /** Есть — кнопка с подписью вместо значка. */
  readonly caption?: string;
  readonly className?: string;
}) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy() {
    const ok = await writeText(text);
    toast.show({ text: ok ? 'Скопировано' : 'Не удалось скопировать. Выделите текст и скопируйте вручную' });
    if (!ok) return;
    setDone(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), DONE_MS);
  }

  return (
    <button
      className={caption ? 'btn is-primary' : className}
      type="button"
      aria-label={`Скопировать: ${label}`}
      onClick={() => void copy()}
    >
      <Icon name={done ? 'check' : 'copy'} />
      {caption}
    </button>
  );
}
