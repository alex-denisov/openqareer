export function ProfileRefreshNotice({
  error,
  onRetry,
}: {
  readonly error?: string;
  readonly onRetry: () => void;
}) {
  if (!error) return null;
  return (
    <div className="career-profile-screen-refresh-error" role="alert">
      <p>{error}</p>
      <button type="button" className="career-quiet-button" onClick={onRetry}>
        Повторить обновление
      </button>
    </div>
  );
}
