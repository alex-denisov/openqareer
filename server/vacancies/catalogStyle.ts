/**
 * Стиль публичного каталога (B535). Шапка, кнопки, подвал и баннер cookie —
 * те же правила, что в src/features/site/publicSite.css; каталог отдаётся
 * сервером без бандла, поэтому правила продублированы здесь.
 */
import { LISTING_STYLE } from './catalogListingStyle';

export const CATALOG_STYLE =
  `body{margin:0}
.ps {
  --ps-bg: oklch(98.4% 0.004 250);
  --ps-bg-2: oklch(96.2% 0.006 250);
  --ps-surface: oklch(99.6% 0.002 250);
  --ps-line: oklch(30% 0.02 255 / 0.1);
  --ps-line-2: oklch(30% 0.02 255 / 0.18);
  --ps-ink: oklch(20% 0.02 260);
  --ps-soft: oklch(40% 0.02 260);
  --ps-mute: oklch(50% 0.015 260);
  --ps-blue: oklch(52% 0.19 256);
  --ps-blue-ink: oklch(98% 0.01 256);
  --ps-blue-soft: oklch(95% 0.03 256);
  --ps-ok: oklch(48% 0.12 155);
  --ps-ok-bg: oklch(95.5% 0.035 155);
  --ps-band: oklch(17% 0.02 258);
  --ps-font: 'Onest', -apple-system, 'Segoe UI', system-ui, sans-serif;
  min-height: 100vh;
  background: var(--ps-bg);
  color: var(--ps-ink);
  font: 400 16px/1.6 var(--ps-font);
  -webkit-font-smoothing: antialiased;
  --brand-ink: var(--ps-ink);
  --brand-core: var(--ps-blue);
}
.ps *,
.ps *::before,
.ps *::after {
  box-sizing: border-box;
}
.ps :where(h1, h2, h3, p, figure, ol, ul) {
  margin: 0;
}
.ps :where(a) {
  color: inherit;
  text-decoration: none;
}
.ps .brand-lockup {
  display: inline-flex;
  align-items: center;
  gap: 9px;
}
.ps .brand-lockup-word {
  font-size: 19px;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--ps-ink);
}
.ps .brand-lockup-qareer {
  color: var(--ps-blue);
}
.ps h1,
.ps h2,
.ps h3 {
  font-weight: 600;
  letter-spacing: -0.025em;
  overflow-wrap: break-word;
}
.ps a:focus-visible,
.ps summary:focus-visible,
.ps .ps-btn:focus-visible {
  outline: 2px solid var(--ps-blue);
  outline-offset: 2px;
  border-radius: 6px;
}
.ps-skip {
  position: absolute;
  left: 16px;
  top: 8px;
  transform: translateY(-200%);
  z-index: 20;
  padding: 10px 14px;
  background: var(--ps-surface);
  border-radius: 8px;
}
.ps-skip:focus {
  transform: none;
}
.ps-wrap {
  max-width: 1180px;
  margin: 0 auto;
  padding: 0 32px;
}
.ps-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--ps-mute);
}
.ps-soft {
  color: var(--ps-soft);
}
.ps-note {
  margin-top: 16px;
  font-size: 13px;
  color: var(--ps-mute);
}
.ps-strong-link {
  color: var(--ps-blue);
  font-weight: 600;
}

/* buttons and chips */
.ps-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 18px;
  border-radius: 10px;
  font-weight: 600;
  font-size: 14px;
  border: 1px solid var(--ps-line-2);
  background: var(--ps-surface);
  color: var(--ps-ink);
}
.ps-btn.is-primary {
  background: var(--ps-blue);
  color: var(--ps-blue-ink);
  border-color: var(--ps-blue);
}
.ps-btn.is-ghost {
  border-color: transparent;
  background: transparent;
}
.ps-btn.is-lg {
  min-height: 50px;
  padding: 0 22px;
  font-size: 15px;
}
.ps-chip {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 9px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  background: var(--ps-bg-2);
  color: var(--ps-soft);
  white-space: nowrap;
}
.ps-chip.is-ok {
  background: var(--ps-ok-bg);
  color: var(--ps-ok);
}
.ps-chip.is-blue {
  background: var(--ps-blue-soft);
  color: var(--ps-blue);
}

/* header */
.ps-top {
  position: sticky;
  top: 0;
  z-index: 20;
  background: oklch(98.4% 0.004 250 / 0.92);
  backdrop-filter: saturate(1.4) blur(10px);
  border-bottom: 1px solid var(--ps-line);
}
.ps-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  height: 64px;
}
.ps-brand {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
}
.ps-nav {
  display: flex;
  gap: 4px;
  font-size: 14px;
  color: var(--ps-soft);
}
.ps-nav a,
.ps-menu a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 10px 12px;
  border-radius: 8px;
}
.ps-nav a:hover,
.ps-menu a:hover {
  color: var(--ps-ink);
  background: var(--ps-bg-2);
}
.ps-nav a[aria-current='page'],
.ps-menu a[aria-current='page'] {
  color: var(--ps-ink);
  font-weight: 600;
}
.ps-top-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.ps-menu-btn {
  display: none;
  width: 44px;
  height: 44px;
  padding: 0;
  border-radius: 10px;
  border: 1px solid var(--ps-line-2);
  background: var(--ps-surface);
  color: var(--ps-ink);
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.ps-menu {
  display: none;
  border-top: 1px solid var(--ps-line);
  background: var(--ps-surface);
  padding: 8px 32px;
  font-size: 14px;
  color: var(--ps-soft);
}
.ps-menu a {
  display: flex;
}
@media (max-width: 1080px) {
  .ps-nav {
    display: none;
  }
  .ps-menu-btn {
    display: inline-flex;
  }
  .ps-menu:not([hidden]) {
    display: flex;
    flex-direction: column;
  }
}
@media (max-width: 760px) {
  .ps-menu {
    padding: 8px 16px;
  }
}
@media (max-width: 360px) {
  .ps-top-actions .is-cta {
    display: none;
  }
}

/* footer */
.ps-plan {
  border-top: 1px solid var(--ps-line);
  background: var(--ps-bg-2);
}
.ps-plan .ps-wrap {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 24px;
  min-height: 64px;
  padding-top: 12px;
  padding-bottom: 12px;
  font-size: 14px;
  color: var(--ps-soft);
}
.ps-plan b {
  color: var(--ps-ink);
  font-weight: 600;
}
.ps-plan-link {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: var(--ps-blue);
  font-weight: 600;
}
.ps-footer {
  border-top: 1px solid var(--ps-line);
  padding: 48px 0 32px;
  font-size: 14px;
  color: var(--ps-mute);
  background: var(--ps-bg-2);
}
.ps-footer-grid {
  display: grid;
  grid-template-columns: 1.5fr repeat(4, minmax(0, 1fr));
  gap: 32px;
}
.ps-footer-about {
  margin-top: 10px;
  max-width: 34ch;
}
.ps-footer-group {
  display: flex;
  flex-direction: column;
}
.ps-footer-group b {
  color: var(--ps-ink);
  margin-bottom: 8px;
  font-weight: 600;
}
.ps-footer-group a {
  padding: 5px 0;
}
.ps-footer-group a:hover {
  color: var(--ps-ink);
}
.ps-footer-cookie {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.ps-footer-cookie:hover {
  color: var(--ps-ink);
}
.ps-footer-cookie:focus-visible {
  outline: 2px solid var(--ps-blue);
  outline-offset: 2px;
}
.ps-footer-legal {
  grid-column: 1 / -1;
  border-top: 1px solid var(--ps-line);
  padding-top: 20px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  font-size: 13px;
}

.ps-crumbs {
  font-size: 13px;
  color: var(--ps-mute);
  margin-bottom: 16px;
}
/*
 * B535: cookie notice built by public/assets/oq-analytics-3.js on the public
 * pages (landing, /faq, /support, /legal/*). Global on purpose: legal pages
 * are not wrapped in \`.ps\`. Quiet bottom card, no backdrop, no layout shift.
 */
.oq-consent {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 40;
  max-width: 340px;
  padding: 14px 16px;
  border: 1px solid oklch(30% 0.02 255 / 0.12);
  border-radius: 14px;
  background: oklch(99.6% 0.002 250);
  color: oklch(20% 0.02 260);
  box-shadow: 0 6px 24px oklch(20% 0.02 260 / 0.1);
  font:
    400 13px/1.5 'Onest',
    -apple-system,
    'Segoe UI',
    system-ui,
    sans-serif;
  animation: oq-consent-in 200ms ease-out;
}
.oq-consent-text {
  margin: 0;
  color: oklch(42% 0.02 260);
}
.oq-consent-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  margin-top: 10px;
}
.oq-consent-accept,
.oq-consent-refuse {
  min-height: 36px;
  padding: 0 16px;
  border-radius: 9px;
  border: 1px solid oklch(50% 0.19 256);
  background: oklch(50% 0.19 256);
  color: oklch(98% 0.01 256);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.oq-consent-refuse {
  background: transparent;
  color: oklch(50% 0.19 256);
}
.oq-consent-more {
  min-height: 24px;
  padding: 0;
  border: 0;
  background: none;
  color: oklch(52% 0.015 260);
  font: inherit;
  cursor: pointer;
}
.oq-consent a {
  color: oklch(52% 0.015 260);
  text-decoration: none;
}
.oq-consent a:hover {
  color: oklch(20% 0.02 260);
}
.oq-consent-more:hover {
  color: oklch(20% 0.02 260);
}
.oq-consent button:focus-visible,
.oq-consent a:focus-visible,
.oq-consent input:focus-visible {
  outline: 2px solid oklch(50% 0.19 256);
  outline-offset: 2px;
}
.oq-consent-option {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin-top: 10px;
  cursor: pointer;
}
.oq-consent-option input {
  width: 18px;
  height: 18px;
  margin: 2px 0 0;
  accent-color: oklch(50% 0.19 256);
}
.oq-consent-option-copy {
  display: flex;
  flex-direction: column;
}
.oq-consent-option-copy b {
  font-weight: 600;
}
.oq-consent-option-copy span {
  color: oklch(52% 0.015 260);
}
@keyframes oq-consent-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
@media (max-width: 560px) {
  .oq-consent {
    left: 12px;
    right: 12px;
    bottom: calc(12px + env(safe-area-inset-bottom));
    max-width: none;
  }
}
@media (pointer: coarse) {
  .oq-consent-accept,
  .oq-consent-refuse {
    min-height: 44px;
  }
  .oq-consent-more {
    min-height: 44px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .oq-consent {
    animation: none;
  }
}


/* B535: public vacancy catalog in the landing chrome. */
.ps-page{padding-top:48px;padding-bottom:96px}
.cat-head h1{font-size:clamp(30px,3.6vw,44px);line-height:1.1;letter-spacing:-0.03em}
.cat-lead{margin-top:12px;font-size:17px;color:var(--ps-soft);max-width:62ch}
.cat-layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:40px;align-items:start;margin-top:32px}
.cat-list{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.cat-card{background:var(--ps-surface);border:1px solid var(--ps-line);border-radius:16px;padding:20px 22px;transition:border-color 180ms ease}
.cat-card:hover{border-color:var(--ps-line-2)}
.cat-card h2{font-size:18px;line-height:1.35}
.cat-card h2 a:hover{color:var(--ps-blue)}
.cat-meta{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:6px;font-size:14px;color:var(--ps-mute)}
.cat-salary{color:var(--ps-ink);font-weight:600;font-variant-numeric:tabular-nums}
.cat-summary{margin-top:10px;font-size:15px;color:var(--ps-soft)}
.cat-empty{margin-top:24px;color:var(--ps-soft)}
.cat-side{position:sticky;top:88px;display:grid;gap:16px}
.cat-box{background:var(--ps-surface);border:1px solid var(--ps-line);border-radius:16px;padding:20px}
.cat-box h2{font-size:16px;margin-bottom:12px}
.cat-box p{font-size:14px;color:var(--ps-soft)}
.cat-box .ps-btn{margin-top:14px;width:100%}
.cat-detail{display:grid;grid-template-columns:minmax(0,46rem) 300px;justify-content:space-between;gap:48px;align-items:start;margin-top:8px}
.cat-detail h1{font-size:clamp(28px,3.2vw,40px);line-height:1.12;letter-spacing:-0.03em}
.cat-body{margin-top:28px;font-size:16px;line-height:1.65;color:var(--ps-soft)}
.cat-body h2{margin:28px 0 10px;font-size:20px;color:var(--ps-ink)}
.cat-body p,.cat-body ul,.cat-body ol{margin:0 0 14px}
.cat-body ul,.cat-body ol{padding-left:22px}
.cat-body li{margin-bottom:6px}
.cat-body strong{color:var(--ps-ink);font-weight:600}
.cat-body code{font:inherit;background:var(--ps-bg-2);padding:1px 6px;border-radius:6px}
.cat-body a{color:var(--ps-blue)}
.cat-skills{list-style:none;display:flex;flex-wrap:wrap;gap:6px;padding:0;margin:16px 0 0}
.cat-skills li{height:28px;display:inline-flex;align-items:center;padding:0 10px;border-radius:8px;background:var(--ps-bg-2);font-size:13px;color:var(--ps-soft)}
.cat-facts{display:grid;gap:10px;margin:0;font-size:14px}
.cat-facts dt{color:var(--ps-mute)}
.cat-facts dd{margin:0 0 4px;color:var(--ps-ink);font-variant-numeric:tabular-nums}
.cat-note{margin-top:32px;font-size:13px;color:var(--ps-mute)}
@media (max-width:900px){.cat-layout,.cat-detail{grid-template-columns:minmax(0,1fr);gap:24px}.cat-side{position:static}}
@media (max-width:760px){.ps-wrap{padding:0 16px}.ps-top-row{height:56px;gap:12px}.ps-top-actions .is-login{display:none}.ps-top-actions .is-cta{min-height:40px;padding:0 12px}.ps-footer-grid{grid-template-columns:1fr 1fr;gap:24px}.ps-footer-grid>div:first-child{grid-column:1/-1}.ps-page{padding-top:28px;padding-bottom:64px}.cat-card{padding:16px}}
@media (prefers-reduced-motion:reduce){.cat-card{transition:none}}

/* B569: mockup 08 — head with facts, search combobox, FAQ */
.cat-vh{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:32px;align-items:start}
.cat-vh>.ps-btn{margin-top:8px}
.cat-search{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) auto;gap:8px;margin:32px 0 24px;padding:8px;border-radius:16px;background:var(--ps-surface);border:1px solid var(--ps-line);box-shadow:0 1px 2px oklch(20% 0.02 260 / .04),0 12px 32px -16px oklch(20% 0.02 260 / .16)}
.cat-fld{position:relative;display:grid;gap:2px;padding:6px 14px;border-radius:10px}
.cat-fld+.cat-fld{border-left:1px solid var(--ps-line);border-radius:0}
.cat-fld:focus-within{background:var(--ps-bg-2)}
.cat-fld label{font-size:13px;font-weight:600;color:var(--ps-mute)}
.cat-in{border:0;min-height:32px;padding:0;font:inherit;font-size:16px;font-weight:500;background:transparent;color:var(--ps-ink);width:100%}
.cat-in:focus{outline:0}
.cat-ac{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:20;list-style:none;margin:0;padding:6px;max-height:320px;overflow-y:auto;background:var(--ps-surface);border:1px solid var(--ps-line);border-radius:10px;box-shadow:0 12px 32px -16px oklch(20% 0.02 260 / .24)}
.cat-ac li{display:flex;justify-content:space-between;gap:12px;align-items:center;min-height:40px;padding:0 10px;border-radius:8px;cursor:pointer;font-size:14px}
.cat-ac li span{color:var(--ps-mute);font-size:13px}
.cat-ac li[aria-selected=true],.cat-ac li:hover{background:var(--ps-bg-2)}
.cat-ac li.sep{min-height:0;height:1px;padding:0;margin:4px 0;background:var(--ps-line);cursor:default}
.cat-ac li.hint{color:var(--ps-mute);cursor:default}
@media (max-width:760px){.cat-vh{grid-template-columns:minmax(0,1fr)}.cat-vh>.ps-btn{display:none}.cat-search{grid-template-columns:minmax(0,1fr);box-shadow:none}.cat-fld+.cat-fld{border-left:0;border-top:1px solid var(--ps-line)}}
` + LISTING_STYLE;
