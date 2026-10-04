import { useState } from 'react';
import { Printer } from '@phosphor-icons/react';
import { isTauriEnvironment } from '../../services/desktop/desktopBridge';
import { saveResumeAsPdf, triggerResumePrint } from './resumeExport';

export function ResumePrintAction() {
  const [message, setMessage] = useState('');
  const [canSavePdf, setCanSavePdf] = useState(false);

  async function print() {
    setMessage('');
    setCanSavePdf(false);
    try {
      await triggerResumePrint();
    } catch {
      setMessage('Печать недоступна — сохраните PDF.');
      setCanSavePdf(isTauriEnvironment());
    }
  }

  async function savePdf() {
    try {
      const path = await saveResumeAsPdf();
      setMessage(path ? `Сохранено: ${path}` : 'PDF не сохранён.');
      setCanSavePdf(!path);
    } catch {
      setMessage('Не удалось сохранить PDF. Попробуйте выбрать другой путь.');
      setCanSavePdf(true);
    }
  }

  return (
    <>
      <button type="button" className="career-resume-export-button" onClick={() => void print()}>
        <Printer size={15} />
        Печать / PDF
      </button>
      {canSavePdf ? (
        <button
          type="button"
          className="career-resume-export-button"
          onClick={() => void savePdf()}
        >
          Сохранить PDF
        </button>
      ) : null}
      {message ? <span role="status">{message}</span> : null}
    </>
  );
}
