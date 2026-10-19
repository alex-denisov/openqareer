import { useRef } from 'react';
import { ChatCircle, UploadSimple } from '@phosphor-icons/react';
import { useResumeIngestion } from '../journey/useResumeIngestion';

const RESUME_FILE_ACCEPT =
  'application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx';
const MAX_RESUME_BYTES = 10 * 1024 * 1024;

export interface ProfileEmptyStartProps {
  readonly onOpenConnections?: () => void;
  readonly onOpenExpert?: () => void;
  readonly onFillManually: () => void;
  /** Резюме сохранено на сервере — профиль перечитывается. */
  readonly onImported: () => void;
  readonly variant: 'desktop' | 'mobile';
}

/**
 * Макет 2 «Пусто: источников нет»: загрузить резюме или рассказать консультанту.
 * «Подключите источник» в тексте — кнопка, иначе на 390 подключение недостижимо.
 */
export function ProfileEmptyStart(props: ProfileEmptyStartProps) {
  const ingestion = useResumeIngestion(true);
  const input = useRef<HTMLInputElement>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_RESUME_BYTES) {
      ingestion.setError('Файл больше 10 МБ. Выберите PDF или DOCX меньшего размера.');
      return;
    }
    if (await ingestion.readPdf(file)) props.onImported();
  };
  return (
    <div className={props.variant === 'mobile' ? 'pm-empty-start' : 'career-profile-screen-state'}>
      <EmptyCopy onOpenConnections={props.onOpenConnections} />
      <input
        ref={input}
        type="file"
        hidden
        accept={RESUME_FILE_ACCEPT}
        aria-label="Файл резюме"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          void pick(file);
        }}
      />
      <div className="career-profile-screen-review-actions">
        <button
          type="button"
          className="career-quiet-button"
          disabled={ingestion.busy}
          onClick={() => input.current?.click()}
        >
          <UploadSimple size={16} aria-hidden="true" />
          {ingestion.busy ? 'Читаем резюме…' : 'Загрузить резюме'}
        </button>
        <SecondaryAction onOpenExpert={props.onOpenExpert} onFillManually={props.onFillManually} />
      </div>
      {ingestion.error ? <p role="alert">{ingestion.error}</p> : null}
    </div>
  );
}

function EmptyCopy({ onOpenConnections }: { readonly onOpenConnections?: () => void }) {
  return (
    <p>
      Профиль пуст.{' '}
      {onOpenConnections ? (
        <button type="button" className="career-inline-link" onClick={onOpenConnections}>
          Подключите источник
        </button>
      ) : (
        'Подключите источник'
      )}{' '}
      или загрузите резюме.
    </p>
  );
}

function SecondaryAction({
  onOpenExpert,
  onFillManually,
}: Pick<ProfileEmptyStartProps, 'onOpenExpert' | 'onFillManually'>) {
  return onOpenExpert ? (
    <button type="button" className="career-text-button" onClick={onOpenExpert}>
      <ChatCircle size={16} aria-hidden="true" />
      Рассказать консультанту
    </button>
  ) : (
    <button type="button" className="career-text-button" onClick={onFillManually}>
      Заполнить профиль вручную
    </button>
  );
}
