import { useId, useState } from 'react';
import { Icon } from '../../kit/Icon';
import { buildNodePath } from '../../routes';
import { Link } from '../../shell/Link';

/** a11b «hh.ru не подключён»: флажок импорта уходит в n03 признаком `import=1|0`. */
export function HhNotConnected() {
  const [withImport, setWithImport] = useState(true);
  const boxId = useId();
  const to = `${buildNodePath('n03')}?import=${withImport ? 1 : 0}`;
  return (
    <ul className="src-list li-off" aria-label="Площадка">
      <li className="src is-next">
        <span className="src-ico">
          <Icon name="brief2" />
        </span>
        <div className="src-main">
          <h2 className="src-title">
            hh.ru<span className="vh"> не подключён</span>
          </h2>
          <div className="check src-imp">
            <input
              id={boxId}
              type="checkbox"
              checked={withImport}
              onChange={(event) => setWithImport(event.target.checked)}
            />
            <label htmlFor={boxId}>Импортировать данные из резюме</label>
          </div>
        </div>
        <Link className="btn is-primary" to={to} aria-label="Подключить hh.ru">
          Подключить
          <Icon name="right" />
        </Link>
      </li>
    </ul>
  );
}
