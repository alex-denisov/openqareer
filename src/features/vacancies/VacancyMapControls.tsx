import { Minus, Plus } from '@phosphor-icons/react';
import { formatCityDisplay, markerLabel, type MapNode } from './vacancyMapCluster';

function capsuleAccessibleName(node: MapNode): string {
  if (!node.isCluster) {
    return `Город ${formatCityDisplay(node.city.city, node.city.country).city}: ${node.count} вакансий`;
  }
  const names = node.cities
    .map((city) => `${formatCityDisplay(city.city, city.country).city} (${city.count})`)
    .join(', ');
  return `Кластер: ${node.totalCount} вакансий (${names}). Нажмите для приближения`;
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
  const tooltip = node.isCluster
    ? capsuleAccessibleName(node)
    : formatCityDisplay(node.city.city, node.city.country).tooltip;
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
      title={tooltip}
      onClick={onClick}
    >
      <span className="career-map-capsule">
        <span>{markerLabel(node)}</span>
        <span className="career-map-label-count">{count}</span>
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
        aria-label="Приблизить карту"
        onClick={onZoomIn}
      >
        <Plus size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="career-map-zoom-btn"
        aria-label="Отдалить карту"
        onClick={onZoomOut}
      >
        <Minus size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
