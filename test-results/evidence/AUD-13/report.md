# AUD-13: итог

- Код: `e5abec33308baec164cf6e6f198166a799cd8530`.
- Файлы (18): `e2e/companies-and-people.spec.ts`; fixtures `mockCandidateCompanies`, `mockSignedInCabinet`, `mockCompanyConnectionCircles`; `server/routes/candidateCompanyRoutes.ts`; `shared/candidateCompany.ts`; `src/features/vacancies/{CompaniesAndPeopleControls,CompaniesAndPeopleScreen,CompanyDetailPanel,CompanyConnectionCircles,VacanciesScreen,VacancyLetterScreen,VacancyHypothesisSection,companies-and-people.css,companiesAndPeopleUtils,companiesAndPeopleUtils.test,vacancyLetterController,useVacancyLetterRoute}`.
- `npx tsc --noEmit` → PASS; `npm run lint` → PASS; focused Vitest → 8 файлов, 44/44.
- `npm run build` → PASS; Vite сообщает о чанке больше 500 kB.
- `e2e/companies-and-people.spec.ts` → 30 passed, 2 expected skipped (32 total; desktop-1440 + mobile-390).
- KIT `verify_responsive.mjs` → 29/29 harness без overflow на 280/320/414 px при scale 1.25; hardcodes 0, theme refs разрешены.
- KIT `accuracy_report.mjs` → ранее 41/41 на неизменённом KIT при AUD-09; дубликатный повтор прекращён после 32 проверок.
- KIT `verify_states.mjs` → 0/262 в default и dark; `measure_render.mjs` → 149 некорректных пар в каждой теме. Обе команды выводят невозможные RGB для `oklch()`; контраст и WCAG не подтверждены.
- Инвентарь: 344 DOM-узла, 29 групп поведения; 20 работают, 3 достроены, 6 внешних; мёртвых и имитированных успехов нет.
- Внешние границы: bulk «Хочу» (B422 без спеки/API), LinkedIn import (B257), поиск публичных профилей (B257/B258), live AI-консультант.
- Связи: путь круга открывает письмо с выбранным кругом; «Хочу» сохраняется после перезагрузки; пустая подборка ведёт в «Карьеру», stale import в Connections.
- 29 PNG/HTML снимков сохранены в ignored evidence; production, реальные провайдеры, AI и визуальная приёмка владельца не проверялись.
- Что было неясно в пакете: B422 показан в макете, но на доске остаётся backlog без спеки и bulk API; действие оставлено отключённым с объяснением.
