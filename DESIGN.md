# openqareer interface contract

This file records the owner-approved visual direction implemented by B116. The
runtime source of truth is `src/features/shell/career-shell.css`; product and
interaction rationale lives in `docs/v1-release/tasks/tickets/B115-ux-research-and-spec.md`.

## Product posture

openqareer is a calm career workspace, not a dashboard of invented scores and
not a linear course. The platform shows one reasoned next decision while the
candidate can revisit profile, career hypotheses and opportunities at any time.

The UI must answer four questions without explanation from support:

1. What does openqareer know about me, and where did it come from?
2. What is still unknown or unconfirmed?
3. What decision should I make next, and why?
4. What can the platform do for me now versus after a connector is enabled?

## Stable information architecture

- `Сегодня` — the current decision, its reason and expected effect.
- `Профиль` — evidence, provenance, corrections and important unknowns.
- `Карьера` — role hypotheses, market routes and the revisable career track.
- `Возможности` — real vacancies, companies and source readiness.
- `Тарифы` — increasing levels of work performed by openqareer.
- `Эксперт` — contextual side panel on desktop and a bottom sheet on mobile.

Screens never replace the application shell. Desktop uses a 76 px navigation
rail and 64 px top bar. Mobile uses a 58 px top bar and four-item bottom
navigation; tariffs remain a visible top action.

## Visual system

- Deep neutral-teal background, bright neutral text and one restrained mint
  accent (`--career-accent`).
- Surfaces are defined by tone and thin edges. No stacked glass cards, fake
  glow, decorative gradients on text, or oversized metric tiles.
- Major radii: 24 px; sections: 16 px; controls: 10–12 px.
- Phosphor icons only. Icons supplement labels and never replace an unfamiliar
  action label.
- System font stack; operational labels and numbers may use the mono token.
- Type scale (B232): six tokens and nothing else — `--career-text-xs` 13 px,
  `-sm` 14, `-md` 16, `-lg` 20, `-xl` 28, `-display` 40. No text below 13 px,
  no literal `font-size` in `career-shell.css` (`cssContract.test.ts`), at most
  six computed sizes on any cabinet screen (`e2e/readability.spec.ts`).
- Type roles on the scale: page title `xl`, card title `sm`/`md`, body `xs`
  (13 px), label/eyebrow `xs` at weight 600 (never heavier than the title
  below it), metric `lg` in `--font-mono`. Numbers — salary, dates, counters —
  are always mono.
- Spacing rhythm: `--career-space-1…8` = 4…32 px in 4 px steps; new rules use
  the tokens rather than raw pixel values.
- Motion is 180–200 ms opacity plus a small transform and is disabled by
  `prefers-reduced-motion`.

## Data and copy rules

- Never show a fit score, market demand, salary or probability without a source,
  sample size and date.
- `Гипотеза`, `не проверено`, `неизвестно`, `подтверждено` and connector states
  are explicit text, not colour-only signals.
- A single pasted vacancy is labelled as one-vacancy comparison, never as
  market analysis.
- Candidate evidence preserves provenance and is editable or rejectable.
- Paid moments follow a demonstrated need; they do not block the initial career
  picture.

## Responsive and accessibility rules

- Primary design widths: 390 px and 1440 px; the desktop app window (1176 px
  content) and the `tauri.conf.json` size (1280 px) are gated too. The document
  must never overflow horizontally at 320 px or wider, and text boxes never
  overlap (`e2e/readability.spec.ts`).
- Long lists render a page of 20 and grow on request; a 400-row list is never
  painted at once.
- Touch targets are at least 44×44 px. Bottom navigation respects safe-area
  insets.
- Every interactive element has a visible focus state. The skip link targets
  `#career-main`.
- Dialog/sheet content has a labelled `dialog`; keyboard trapping and Escape
  behaviour remain a release gate.
- Tables collapse into stacked rows on mobile.

## Component vocabulary

- `CareerWorkspaceShell` — persistent application frame and navigation.
- `CareerIntake` — adaptive three-stage start: intent, source, context.
- `CareerPictureRibbon` — compact, traceable state of evidence, roles and market.
- `CareerExpertPanel` — reasoned next action plus protected model conversation.
- `CareerTrack` — revisable dependency path, not course completion.
- `SourceCapability` — honest `available`, `prepared`, or future connector state.

Any new surface must reuse this vocabulary or record why a new pattern is
necessary in its ticket before implementation.
