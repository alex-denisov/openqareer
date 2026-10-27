/**
 * B569: styles of the catalog list page, values taken from mockup 08
 * (08-vacancies.html) on the catalog's own tokens. Folding hides rows only
 * when the page script has run, so the table is complete without it.
 */
export const LISTING_STYLE = `
.lv-main{display:block}
.lv-main .ps-btn{min-height:44px;padding:0 18px;font-size:14px}
.lv-main .ps-btn.is-lg{min-height:52px;padding:0 24px;font-size:16px}
.lv-crumbs{display:flex;flex-wrap:wrap;gap:6px;font-size:13px;color:var(--ps-mute);padding-top:24px}
.lv-crumbs a:hover{color:var(--ps-ink)}
.lv-crumbs span[aria-hidden]{opacity:.6}
.lv-phero{padding:40px 0 24px}
.lv-phero h1{font-size:clamp(30px,3.4vw,44px);line-height:1.08;letter-spacing:-.03em;margin-top:16px;max-width:24ch;text-wrap:balance}
.lv-phero .cat-search{margin:32px 0 0}
.lv-facts{display:flex;flex-wrap:wrap;gap:6px 24px;font-size:16px;color:var(--ps-soft);margin-top:16px}
.lv-facts b{color:var(--ps-ink);font-variant-numeric:proportional-nums}
.lv-alert{color:var(--ps-blue);font-weight:600;display:inline-flex;align-items:center;gap:6px;min-height:auto}
.lv-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:40px;align-items:start;padding-bottom:64px}
.lv-card{background:var(--ps-surface);border:1px solid var(--ps-line);border-radius:16px}
.lv-card-h{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 20px;font-size:13px;color:var(--ps-mute);border-bottom:1px solid var(--ps-line)}
.lv-job{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 16px;padding:16px 20px;border-top:1px solid var(--ps-line);align-items:center}
.lv-t{font-weight:600;font-size:16px;line-height:1.35}
.lv-t a{display:inline-block;padding:10px 0;margin:-10px 0}
.lv-t a:hover{color:var(--ps-blue)}
.lv-s{font-size:14px;font-weight:600;text-align:right;white-space:nowrap;font-variant-numeric:proportional-nums}
.lv-s.lv-none{font-weight:500;color:var(--ps-mute)}
.lv-m{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:13px;color:var(--ps-mute)}
.lv-src{color:var(--ps-soft)}
.lv-tags{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.lv-chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:8px;font-size:13px;font-weight:500;background:var(--ps-bg-2);color:var(--ps-soft);white-space:nowrap}
.lv-lock{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:center;padding:16px 20px;border-top:1px solid var(--ps-line);background:var(--ps-blue-soft)}
.lv-lock p{font-size:14px;color:var(--ps-soft)}
.lv-lock b{color:var(--ps-ink)}
.lv-answer{margin-top:24px;padding:16px 20px;border-left:3px solid var(--ps-blue);background:var(--ps-surface);border-radius:0 10px 10px 0;max-width:72ch;font-size:16px;color:var(--ps-soft)}
.lv-answer b{color:var(--ps-ink)}
.lv-sticky{display:none}
.lv-pager{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:16px;font-size:14px;color:var(--ps-mute)}
.lv-side{display:grid;gap:16px;position:sticky;top:88px}
.lv-side .lv-card{padding:20px}
.lv-side h2{font-size:16px;margin-bottom:10px}
.lv-sal{display:grid;gap:4px}
.lv-sal b{font-size:30px;letter-spacing:-.02em;font-variant-numeric:proportional-nums}
.lv-sal span{font-size:14px;color:var(--ps-soft)}
.lv-sal .lv-small{font-size:13px;color:var(--ps-mute)}
.lv-side .lv-dark{background:var(--ps-band);color:oklch(95% 0.008 255);border:0}
.lv-side .lv-dark p{color:oklch(78% 0.02 255);font-size:14px;margin:6px 0 14px}
.lv-side .lv-dark .ps-btn{width:100%;white-space:normal;text-align:center}
.lv-link{color:var(--ps-blue);font-weight:600;display:inline-flex;align-items:center;gap:6px;min-height:44px}
.lv-ic{width:16px;height:16px;flex:none;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.lv-sec{padding:80px 0;border-top:1px solid var(--ps-line)}
.lv-facets{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.lv-facets .lv-card{padding:20px}
.lv-facets h2{font-size:16px;margin-bottom:8px}
.lv-facet{list-style:none;padding:0;display:grid}
.lv-facet a{display:flex;justify-content:space-between;gap:12px;align-items:center;min-height:40px;font-size:16px;border-bottom:1px solid var(--ps-line)}
.lv-facet li:last-child a{border-bottom:0}
.lv-facet a:hover{color:var(--ps-blue)}
.lv-facet span{color:var(--ps-mute);font-size:14px;font-variant-numeric:proportional-nums}
.lv-prep{display:grid}
.lv-prep .lv-link{width:fit-content}
.lv-sh{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:64px;margin-bottom:48px;align-items:end}
.lv-sh h2{font-size:clamp(28px,3.2vw,40px);line-height:1.12;margin-top:12px}
.lv-faq{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 56px}
.lv-q{border-top:1px solid var(--ps-line)}
.lv-q summary{cursor:pointer;font-weight:600;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:16px;min-height:56px;padding:12px 0}
.lv-q summary::-webkit-details-marker{display:none}
.lv-q summary::after{content:"";flex:none;width:10px;height:10px;margin-right:4px;border-right:1.8px solid var(--ps-mute);border-bottom:1.8px solid var(--ps-mute);transform:rotate(45deg) translate(-3px,-3px);transition:transform .18s}
.lv-q[open] summary::after{transform:rotate(225deg) translate(-2px,-2px)}
.lv-a{padding:0 0 20px;color:var(--ps-soft);font-size:16px;max-width:68ch}
.lv-a a{color:var(--ps-blue);font-weight:600}
.lv-fold-more{margin-top:16px}
.fx{display:none!important}
@media (min-width:761px){.fx-m{display:revert!important}.lv-fold-more.m-only{display:none}}
@media (max-width:1080px){.lv-grid{grid-template-columns:minmax(0,1fr)}.lv-side{position:static;grid-template-columns:repeat(2,minmax(0,1fr))}.lv-facets{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:760px){
.lv-crumbs{padding-top:16px}
.lv-main{padding-bottom:calc(72px + env(safe-area-inset-bottom))}
.lv-hm{display:none!important}
.lv-sec{padding:28px 0}
.lv-sh>p{display:none}
.lv-sticky{display:flex;position:sticky;bottom:0;z-index:15;margin:0 -16px;padding:10px 16px calc(10px + env(safe-area-inset-bottom));background:oklch(99.6% 0.002 250 / .95);backdrop-filter:blur(8px);border-top:1px solid var(--ps-line)}
.lv-sticky .ps-btn{width:100%}
.lv-jobs{border-radius:0;border-left:0;border-right:0;margin:0 -16px}
.lv-job{padding:14px 16px}
.lv-lock{grid-template-columns:minmax(0,1fr);padding:16px}
.lv-side{grid-template-columns:minmax(0,1fr)}
.lv-facets{grid-template-columns:minmax(0,1fr)}
.lv-sh,.lv-faq{grid-template-columns:minmax(0,1fr)}
}
`;
