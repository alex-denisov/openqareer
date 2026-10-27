import React from 'react';
import { Check } from '@phosphor-icons/react';
import { HOME_TIERS, type HomeTier } from './landingHomeContent';

function TierCard({ tier }: { readonly tier: HomeTier }) {
  return (
    <div
      className={tier.recommended ? 'tier hl' : 'tier'}
      id={tier.id === 'exec' ? 'executive' : undefined}
    >
      <span className="nm">
        {tier.name}
        {tier.recommended ? <span className="chip blue">Рекомендуем</span> : null}
      </span>
      <span className="who">{tier.who}</span>
      <span className="pr">{tier.price}</span>
      <span className="tm">{tier.term}</span>
      <ul>
        {tier.lead ? <li className="all">{tier.lead}</li> : null}
        {tier.items.map((item) => (
          <li key={item}>
            <Check className="ic" aria-hidden="true" />
            {item}
          </li>
        ))}
      </ul>
      <a className={tier.recommended ? 'btn primary' : 'btn'} href={tier.action.href}>
        {tier.action.label}
      </a>
    </div>
  );
}

function centerOffset(track: HTMLElement, card: HTMLElement): number {
  return card.offsetLeft - track.offsetLeft - (track.clientWidth - card.offsetWidth) / 2;
}

function nearestCard(track: HTMLElement): number {
  const cards = Array.from(track.children) as HTMLElement[];
  const middle = track.scrollLeft + track.clientWidth / 2;
  let best = 0;
  let bestGap = Infinity;
  cards.forEach((card, index) => {
    const gap = Math.abs(card.offsetLeft - track.offsetLeft + card.offsetWidth / 2 - middle);
    if (gap < bestGap) {
      best = index;
      bestGap = gap;
    }
  });
  return best;
}

/** Five cards; on a phone they swipe sideways, Pro first, with dot switches. */
export function LandingTiers() {
  const track = React.useRef<HTMLDivElement>(null);
  const [current, setCurrent] = React.useState(2);

  React.useEffect(() => {
    const node = track.current;
    const pro = node?.children[2] as HTMLElement | undefined;
    if (node && pro && node.scrollWidth > node.clientWidth) {
      node.scrollLeft = centerOffset(node, pro);
      setCurrent(nearestCard(node));
    }
  }, []);

  const show = (index: number) => {
    const node = track.current;
    const card = node?.children[index] as HTMLElement | undefined;
    if (node && card) node.scrollTo({ left: centerOffset(node, card), behavior: 'smooth' });
  };

  return (
    <>
      <div
        className="tiers"
        id="tiers"
        ref={track}
        onScroll={() => track.current && setCurrent(nearestCard(track.current))}
      >
        {HOME_TIERS.map((tier) => (
          <TierCard key={tier.id} tier={tier} />
        ))}
      </div>
      <div className="dots" aria-label="Тарифы">
        {HOME_TIERS.map((tier, index) => (
          <button
            key={tier.id}
            type="button"
            aria-label={tier.name}
            aria-current={index === current}
            onClick={() => show(index)}
          />
        ))}
      </div>
    </>
  );
}
