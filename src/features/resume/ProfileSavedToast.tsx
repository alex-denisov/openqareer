import { useEffect } from 'react';
import { CheckCircle } from '@phosphor-icons/react';

const TOAST_VISIBLE_MS = 3500;

/** «Сохранено» after a profile dialog closes; hides itself, announced politely. */
export function ProfileSavedToast({
  visible,
  onDismiss,
}: {
  readonly visible: boolean;
  readonly onDismiss: () => void;
}) {
  useEffect(() => {
    if (!visible) return undefined;
    const timer = window.setTimeout(onDismiss, TOAST_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [visible, onDismiss]);
  if (!visible) return null;
  return (
    <div className="profile-saved-toast" role="status">
      <CheckCircle size={16} aria-hidden="true" />
      <span>Сохранено</span>
    </div>
  );
}
