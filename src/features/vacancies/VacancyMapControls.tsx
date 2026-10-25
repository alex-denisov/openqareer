import { Minus, Plus } from '@phosphor-icons/react';
import { pluralRu } from '../../../shared/pluralRu';
import {
  formatCityDisplay,
  markerLabel,
  type MapClusterNode,
  type MapNode,
} from './vacancyMapCluster';

const TIP_CITY_ROWS = 6;

function capsuleAccessibleName(node: MapNode): string {
  if (!node.isCluster) {
    return `Город ${formatCityDisplay(node.city.city, node.city.country).city}: ${node.count} вакансий`;
  }
  const names = node.cities
    .map((city) => `${formatCityDisplay(city.city, city.country).city} (${city.count})`)
    .join(', ');
  return `Кластер: ${node.totalCount} вакансий (${names}). Нажмите для приближения`;
}

/** B553: состав кластера — заголовок, до шести крупнейших городов, остаток одной строкой. */
function ClusterTip({ node }: { readonly node: MapClusterNode }) {
  const cities = [...node.cities].sort((a, b) => b.count - a.count);
  const shown = cities.slice(0, TIP_CITY_ROWS);
  const rest = cities.slice(TIP_CITY_ROWS);
  const restCount = rest.reduce((sum, city) => sum + city.count, 0);
  const singular = cities.length % 10 === 1 && cities.length % 100 !== 11;
  const where = `в ${cities.length} ${singular ? 'городе' : 'городах'}`;
  return (
    <>
      <span className="career-map-tip-title">
        {pluralRu(node.totalCount, ['вакансия', 'вакансии', 'вакансий'])} {where}
      </span>
      <span className="career-map-tip-list">
        {shown.map((city) => (
          <span className="career-map-tip-row" key={`${city.city}|${city.country ?? ''}`}>
            <span className="career-map-tip-city">
              {formatCityDisplay(city.city, city.country).city}
            </span>
            <span className="career-map-tip-count">{city.count}</span>
          </span>
        ))}
      </span>
      {rest.length > 0 ? (
        <span className="career-map-tip-more">
          и ещё {pluralRu(rest.length, ['город', 'города', 'городов'])} · {restCount}
        </span>
      ) : null}
      <span className="career-map-tip-hint">Нажмите, чтобы приблизить</span>
    </>
  );
}

/** B446-g4/B553: капсула «Москва 74» поверх карты (макет 4: 44 px, 13 px, число акцентом). */
export function MapCapsuleButton({
  node,
  x,
  y,
  count,
  active,
  onClick,
}: {
  readonly node: MapNode;
  readonly x: number;
  readonly y: number;
  readonly count: number;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`career-map-marker${node.isCluster ? ' career-map-cluster-node' : ''}${active ? ' is-active' : ''}`}
      ref={(element) => {
        // Позиция меняется на каждом кадре движения карты; CSSOM, а не атрибут style (CSP).
        element?.style.setProperty(
          'transform',
          `translate(${Math.round(x)}px, ${Math.round(y)}px)`,
        );
      }}
      aria-label={capsuleAccessibleName(node)}
      aria-pressed={node.isCluster ? undefined : active}
      onClick={onClick}
    >
      <span className="career-map-capsule">
        <span>{markerLabel(node)}</span>
        <span className="career-map-label-count">{count}</span>
      </span>
      {/* B553: свой элемент вместо title — нативная подсказка в окне Tauri без фона. Текст уже в aria-label. */}
      <span className="career-map-tip" aria-hidden="true">
        {node.isCluster ? (
          <ClusterTip node={node} />
        ) : (
          formatCityDisplay(node.city.city, node.city.country).tooltip
        )}
      </span>
    </button>
  );
}

export function MapZoomControls({
  onZoomIn,
  onZoomOut,
}: {
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
}) {
  return (
    <div className="career-map-zoom-controls" role="group" aria-label="Управление масштабом карты">
      <button
        type="button"
        className="career-map-zoom-btn"
        aria-label="Приблизить"
        onClick={onZoomIn}
      >
        <Plus size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="career-map-zoom-btn"
        aria-label="Отдалить"
        onClick={onZoomOut}
      >
        <Minus size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
