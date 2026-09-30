/**
 * WKWebView in the .app never shows native `title` tooltips, so every
 * explanation carried only by `title` — the ⓘ next to «Совпадение», the fit
 * dots, level marks — was invisible on desktop (B331). One delegated
 * listener renders the same text in a small floating tip on hover, focus
 * or click. The attribute is parked in `data-oq-title` while the tip is
 * open so the browser does not show both, and restored on leave.
 */
const TIP_CLASS = 'oq-title-tip';
const PARKED = 'data-oq-title';

export function installTitleTooltips(root: Document): () => void {
  const tip = root.createElement('div');
  tip.className = TIP_CLASS;
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  root.body.appendChild(tip);
  let owner: HTMLElement | null = null;

  const hide = () => {
    if (owner) {
      const text = owner.getAttribute(PARKED);
      if (text !== null) owner.setAttribute('title', text);
      owner.removeAttribute(PARKED);
    }
    owner = null;
    tip.hidden = true;
  };

  const show = (event: Event) => {
    const target = event.target instanceof Element ? event.target : null;
    const element = target?.closest<HTMLElement>('[title], [data-oq-title]');
    if (!element || element === owner) return;
    const text = element.getAttribute('title') ?? element.getAttribute(PARKED);
    if (!text) return;
    hide();
    owner = element;
    element.setAttribute(PARKED, text);
    element.removeAttribute('title');
    tip.textContent = text;
    tip.hidden = false;
    place(tip, element, root);
  };

  const leave = (event: Event) => {
    const next = (event as MouseEvent).relatedTarget;
    if (owner && next instanceof Node && owner.contains(next)) return;
    hide();
  };

  root.addEventListener('mouseover', show);
  root.addEventListener('focusin', show);
  root.addEventListener('click', show);
  root.addEventListener('mouseout', leave);
  root.addEventListener('focusout', leave);
  root.addEventListener('scroll', hide, true);
  return () => {
    hide();
    root.removeEventListener('mouseover', show);
    root.removeEventListener('focusin', show);
    root.removeEventListener('click', show);
    root.removeEventListener('mouseout', leave);
    root.removeEventListener('focusout', leave);
    root.removeEventListener('scroll', hide, true);
    tip.remove();
  };
}

/** Below the element, kept inside the viewport horizontally. */
function place(tip: HTMLElement, element: HTMLElement, root: Document): void {
  const rect = element.getBoundingClientRect();
  const width = root.documentElement.clientWidth || 1024;
  const maxLeft = Math.max(8, width - 328);
  tip.style.top = `${Math.round(rect.bottom + 6)}px`;
  tip.style.left = `${Math.round(Math.min(Math.max(8, rect.left), maxLeft))}px`;
}
