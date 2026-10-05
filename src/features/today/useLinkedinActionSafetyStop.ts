import { useEffect, useState } from 'react';
import {
  getLinkedinActionSafetyStatus,
  resumeLinkedinActions,
  type LinkedinActionSafetyStatus,
} from './linkedinActionSafetyApi';

export function useLinkedinActionSafetyStop() {
  const [status, setStatus] = useState<LinkedinActionSafetyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resuming, setResuming] = useState(false);

  useEffect(() => {
    let active = true;
    void getLinkedinActionSafetyStatus().then(
      value => {
        if (!active) return;
        setStatus(value);
        setLoading(false);
      },
      () => {
        if (!active) return;
        setError('Не удалось проверить статус действий LinkedIn.');
        setLoading(false);
      },
    );
    return () => { active = false; };
  }, []);

  async function resumeManually() {
    if (!status?.paused || !status.canResume || resuming) return;
    setResuming(true);
    setError('');
    setNotice('');
    try {
      const nextStatus = await resumeLinkedinActions();
      setStatus(nextStatus);
      if (!nextStatus.paused) {
        setNotice('Пауза снята. Следующий запуск потребует вашего подтверждения.');
      }
    } catch {
      setError('Не получилось снять паузу LinkedIn. Проверьте подключение и повторите попытку.');
    } finally {
      setResuming(false);
    }
  }

  return {
    linkedinSafetyStop: status,
    safetyStatusLoading: loading,
    safetyError: error,
    safetyNotice: notice,
    resumingLinkedin: resuming,
    resumeLinkedinManually: resumeManually,
  };
}
