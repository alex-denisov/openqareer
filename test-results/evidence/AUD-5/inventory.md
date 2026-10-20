# AUD-5 — инвентарь экрана «Отклики»

Источник: утверждённый `5-otkliki.html`, состояния и варианты «Воронка» 1440/390, «Подготовка» 1440, «Офферы» 1440. Повторяющиеся одинаковые действия сгруппированы по поведению; каждая строка относится ко всем видимым копиям в вариантах экрана. В таблице 34 группы действий; статус считает группу целиком.

## Покрытие эталона

В `#screen` насчитано 271 интерактивный DOM-узел: 133 button, 85 ссылок, 46 input, 6 select, 1 textarea. В блоке «Состояния» ещё 3 действия (2 button, 1 ссылка). Итого 274 узла в 54 сочетаниях tag/class. Навигация по 20 экранам обёртки и 4 ссылки «полный размер» не входят в экран.

Сводка групп поведения: **34 всего / 26 работает / 3 достроено / 5 внешняя зависимость**. `достроено` — CSV-экспорт, метки отклика, явная заметка о малой выборке. Для внешних данных интерфейс показывает границу и не выдаёт неподтверждённый результат за успех.

## Интерактивные элементы

| № | Блок / элемент (повторы сгруппированы) | Действие по макету и проверка | Где в приложении | Статус |
|---:|---|---|---|---|
| 1 | Пропуск к содержимому и навигация разделов | Переход к разделу кабинета; проверяется в readability | `src/features/shell/CareerWorkspaceShell.tsx:428`, `CareerShellNavigation.tsx:79`; `e2e/readability.spec.ts:284` | работает |
| 2 | Уведомления, аккаунт, вход в консультанта | Открывают соответствующую панель/раздел | `src/features/shell/DesktopCabinetTopbar.tsx:36`, `CareerWorkspaceShell.tsx:758` | работает |
| 3 | Вкладки «Воронка / Хочу в компанию / Подготовка / Офферы» | Переключают реальные панели | `src/features/applications/ResponsesWorkspaceControls.tsx:16`; `e2e/b450-responses-workspace.spec.ts:949` | работает |
| 4 | Сводные этапы воронки | Фильтруют карточки по этапу и показывают счётчики | `ResponsesWorkspaceControls.tsx:123`; `ResponsesBoard.test.tsx:545` | работает |
| 5 | Поиск по компании, роли и источнику | Фильтрует серверную выборку; поиск за первой страницей проверен E2E | `ResponsesWorkspaceControls.tsx:242`; `e2e/b450-responses-workspace.spec.ts:981` | работает |
| 6 | Канал, период, сортировка | Обновляют фильтр и выборку; параметры проверяются API-тестом | `ResponsesWorkspaceControls.tsx:242`; `server/applicationsRoute.test.ts:345` | работает |
| 7 | Сброс активного этапа | Снимает фильтр и возвращает все колонки | `ResponsesBoard.tsx:155`; `ResponsesBoard.test.tsx:315` | работает |
| 8 | Переключение «Колонки / Таблица» | Показывает соответствующий вид тех же откликов | `ResponsesWorkspaceControls.tsx:209`; `ResponsesBoard.test.tsx:566` | работает |
| 9 | Карточка отклика: выбор и открытие подробностей | Выбор карточки открывает панель с её статусами и действиями | `ResponsesCard.tsx:162`; `e2e/responses-screen.spec.ts:306` | работает |
| 10 | Строки таблицы и их выбор | Выбор отклика доступен и в табличном режиме | `ResponsesApplicationsTable.tsx:49`; `e2e/b450-responses-workspace.spec.ts:667` | работает |
| 11 | «Показать ещё 20» / страницы таблицы | Загружает следующую порцию, не подменяя общий счётчик | `ResponsesWorkspace.tsx:265`; `e2e/b450-responses-workspace.spec.ts:667` | работает |
| 12 | Выбрать текущую страницу | Меняет список выбранных откликов | `ResponsesApplicationsTable.tsx:231`; `e2e/b450-responses-workspace.spec.ts:667` | работает |
| 13 | Выбрать все по фильтру | Выбирает весь отфильтрованный набор через серверный контракт | `ResponsesApplicationsTable.tsx:201`; `server/applicationsRoute.test.ts:474` | работает |
| 14 | Массовый повтор откликов | Готовит подтверждённую очередь; E2E проверяет `sentCount: 0` и отсутствие отправки | `ResponsesApplicationsTable.tsx:201`; `e2e/b450-responses-workspace.spec.ts:667` | работает |
| 15 | Массово изменить этап / закрыть | Применяет подтверждённое действие к выбранным карточкам | `ResponsesApplicationsTable.tsx:120`; `server/applicationsRoute.test.ts:474` | работает |
| 16 | Меню карточки: этап, черновик ответа, заметка, пропуск | Открывает реальные формы/действия карточки | `ResponsesCard.tsx:247`, `ResponsesCard.tsx:646`; `e2e/responses-screen.spec.ts:721` | работает |
| 17 | Квитанция hh.ru и ошибка доставки | Отображает сохранённое подтверждение или причину отказа; ошибку проверяет E2E | `ResponsesCardStageControls.tsx:15`; `e2e/b450-responses-workspace.spec.ts:1025` | работает |
| 18 | Частичное состояние LinkedIn без квитанции | Показывает «Подтверждение LinkedIn не получено; доставка не подтверждена.»; фактическое подключение аккаунта неизвестно | `ResponsesCardStageControls.tsx:15`; `e2e/b450-responses-workspace.spec.ts:1046` | внешняя зависимость |
| 19 | Срок следующего шага и отметка о напоминании | Сохраняет дату и статус на сервере | `ResponsesCardStageControls.tsx:128`, `:169`; `e2e/responses-screen.spec.ts:537` | работает |
| 20 | Архив и восстановление | Показывает причину закрытия и возвращает прежний этап | `ArchivedResponsesSection.tsx:31`; `e2e/responses-screen.spec.ts:351` | работает |
| 21 | Реальная отправка через hh.ru | Очередь локально подготовлена; отправка требует подключённой сессии runner | `CandidateActionPanel.tsx:145`; `CandidateActionPanel.test.tsx:194` | внешняя зависимость |
| 22 | Реальная отправка через LinkedIn | Очередь локально подготовлена; реальная сессия/runner не подключены и не проверялись | `CandidateActionPanel.tsx:145`; `CandidateActionPanel.test.tsx:194` | внешняя зависимость |
| 23 | «Хочу в компанию», убрать, следующий шаг | Сохраняет предпочтение и шаг контакта; проверено после reload | `ResponsesCompanyWants.tsx:52`, `:224`; `e2e/b450-responses-workspace.spec.ts:790` | работает |
| 24 | Поиск, фильтр, сортировка, пагинация и bulk в «Хочу» | Обновляет список и выборку компаний | `ResponsesCompanyWants.tsx:150`, `:160`, `:168`; `e2e/b450-responses-workspace.spec.ts:834` | работает |
| 25 | «Найти путь к рекрутеру» | Ставит серверную задачу поиска и показывает очередь без фальшивого результата | `ResponsesCompanyWants.tsx:224`, `:300`; `e2e/b450-responses-workspace.spec.ts:807` | работает |
| 26 | Фактические контакты и путь к рекрутеру | Реальные публичные результаты B257/B258 в этом окружении не подтверждены | `ResponsesCompanyWants.tsx:224`; `server/recruiterIntelligenceRoute.test.ts` | внешняя зависимость |
| 27 | STAR-истории и факты-источники | Создаёт/читает истории, сохраняет provenance фактов | `src/features/interview/StarStoriesModal.tsx:64`; `server/starStoryRoutes.test.ts:82` | работает |
| 28 | Мок-интервью | Запускает локальную сессию, показывает и сохраняет вопрос/ответ | `src/features/interview/MockInterviewSimulator.tsx:40`; `server/interviewSimulatorRoutes.test.ts:148`; `e2e/b450-responses-workspace.spec.ts:1066` | работает |
| 29 | Офферы: добавить, изменить и сравнить | Сохраняет состав компенсации и открывает сравнение | `ResponsesOffersPanel.tsx:10`, `OfferComparisonMatrix.tsx:1`; `e2e/b450-responses-workspace.spec.ts:896` | работает |
| 30 | Панель консультанта: открыть, история, сворачивание | Управляет панелью и историей диалогов | `src/features/shell/CareerWorkspaceShell.tsx:758`; `ResponsesCard.tsx:290` | работает |
| 31 | Живой ответ AI-консультанта | В локальном сценарии используются синтетические ответы; реальный provider не проверялся | `ResponsesCard.tsx:290`; provider runtime | внешняя зависимость |
| 32 | Экспорт отклика в CSV | Скачивает CSV из данных карточки; E2E проверяет download | `ResponsesCard.tsx:681`; `e2e/b450-responses-workspace.spec.ts:863` | достроено |
| 33 | Создать, назначить и снять метку | CRUD идёт через candidate API и сохраняется после reload | `ApplicationLabelsEditor.tsx:16`, `applicationsApi.ts:65`; `server/applicationsRoute.test.ts:415`; `e2e/b450-responses-workspace.spec.ts:863` | достроено |
| 34 | Мало данных в воронке | Для 1–19 откликов показывает «Меньше 20 откликов: узкие места не определены.» | `ResponsesChannelPerformance.tsx:35`, `:107`; `e2e/responses-screen.spec.ts:681`; `pipelineAnalytics.test.ts:103` | достроено |

## Состояния макета

| Состояние | Доказательство достижимости | Статус |
|---|---|---|
| Загрузка | `ResponsesBoard.test.tsx:120`: `aria-busy` и текст загрузки | работает |
| Пусто: откликов нет | `e2e/responses-screen.spec.ts:605` | работает |
| Ошибка доставки | `e2e/b450-responses-workspace.spec.ts:1025` | работает |
| Частично: LinkedIn без квитанции | `e2e/b450-responses-workspace.spec.ts:1046`; UI говорит только об отсутствии подтверждения, статус подключения неизвестен | внешняя зависимость |
| Много откликов | `e2e/b450-responses-workspace.spec.ts:667`: страницы 20→40 | работает |
| Мало данных: воронка | `e2e/responses-screen.spec.ts:681`: выборка 7; доменный тест задаёт границу 19/20 | достроено |

## Сквозные связи и границы

Board, table и «Результативность по каналам» показывают одну выборку (`e2e/responses-screen.spec.ts:681`). Метки и «Хочу» проходят reload в синтетических E2E; candidate API и STAR route проходят серверные CRUD, provenance и candidate-scope тесты. Реальная отправка hh.ru/LinkedIn, LinkedIn receipts/session, OSINT-контакты и live AI остаются внешними границами; production-аккаунты не использовались.

`PipelineAnalyticsView.tsx` не имеет importers; утверждённый экран использует подключённый `ResponsesChannelPerformance`, где и показано состояние малой выборки. B486 отвечает за отдельную 390-раскладку; её файлы не менялись.
