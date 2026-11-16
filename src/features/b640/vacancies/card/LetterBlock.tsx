import { Icon, Link } from '../../kit';
import { buildNodePath } from '../../routes';
import { Fold } from './Fold';

/** «Письмо и резюме»: одна кнопка в письмо отклика. */
export function LetterBlock({ vacancyId }: { readonly vacancyId: string }) {
  return (
    <Fold title="Письмо и резюме">
      <div className="actions">
        <Link className="btn" to={buildNodePath('o02', { responseId: vacancyId })}>
          <Icon name="mail" />
          Подготовить письмо
        </Link>
      </div>
    </Fold>
  );
}
