import { Icon, Link } from '../../kit';
import { buildNodePath } from '../../routes';

/** Отклик уже отправлен: вместо нового письма — он сам (B801). */
export function AppliedLink({ responseId, className }: { readonly responseId: string; readonly className: string }) {
  return (
    <Link className={className} to={buildNodePath('o01c', { responseId })}>
      <Icon name="check" />
      Откликнулся
    </Link>
  );
}
