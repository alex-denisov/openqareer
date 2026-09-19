---
id: B229
title: "Production-safe lazy catalog и bounded maintenance пула вакансий"
type: change
status: in_progress
priority: P0
milestone: v1
horizon: H1
team: [backend, devops, qa]
risk: high
depends: [B220, B221]
links: [B209, B216, B219, B220, B221, PRB-027]
created: 2026-09-19
owner-decision: |
  Владелец, 2026-09-19: подтвердить, что lazy load для большого каталога нужен,
  зафиксировать сделанное и продолжить следующую сессию с полноценной
  SQL-проекцией, cursor pagination и bounded maintenance.
---

## Цель

Каталог вакансий должен обслуживать сотни тысяч и миллионы записей, не загружая
весь пул или весь снимок кластеров в heap Node и не блокируя `/health` во время
старта, синхронизации или пересборки.

## Что выявлено 2026-09-19

На origin `openqareer-eu-1` в базе было около **559 405 вакансий**, **380 717
кластеров** и SQLite-файл около **3,75 ГБ**. Старый public request приводил к
`loadClusters()` и синхронному разбору `cluster_json`; в журнале Node были
`node:sqlite StatementExecutionHelper::All` и OOM/долгие D-state блокировки.
`LIMIT 24` на маршруте сам по себе проблему не решал: startup restore,
source-health и первый `syncDue` обходили лимит и снова поднимали весь снимок.

## Сделано и выкачено

### B221 production correction

- `SqliteVacancyPoolStore.loadClustersPage(limit, offset)` читает ограниченный
  срез JSON вместо полного `loadClusters()`.
- Добавлен индекс `vacancy_clusters_freshness` по `(updated_at DESC, id ASC)`.
- `finishRestore()` для SQLite не гидратирует весь durable cluster snapshot.
- `healthOf()` не вызывает полную гидрацию при проверке каждого источника.
- startup не выполняет full replay/recluster и не запускает source sync до
  отдельного bounded maintenance worker; публичный каталог читает indexed page
  напрямую.
- startup pruning переведён на bounded batches; write-side cleanup удалён из
  readiness path большого production pool.
- старые обходы, которые могли вернуть `loadClusters()` после restore, убраны.

Основные коммиты этой коррекции: `cef0d40`, `75b8609`, `fad8c69`, `31a090c`,
`8373cc5`, `fc16e17`, `b7d242e`, `b08e001`, `391e073`, `9bb256c`.

### Связанные работы предыдущих задач

| Область | Что уже сделано | Граница готовности |
|---|---|---|
| B219 / PRB-026 | Resumable hh sweep, cursor/dropObservedBefore и защита от преждевременного удаления | Работает в общем ingest-контракте; полноценный production source-sync сейчас намеренно paused этим тикетом до bounded worker |
| B220 | Memory guard с hysteresis 75%/65% | Это страховка, не замена SQL maintenance |
| B221 / PRB-027 | SQLite pool/index, compact cluster input, SQL matching, persisted clusters, lazy startup correction | Полная materialized catalog projection и cursor pagination остаются в B229 |
| B208 | Технический Obscura LinkedIn crawler/account-pool shell и ADR-009 safeguards | Live production browser runtime и реальная account-pool acceptance не подтверждены этим тикетом |
| B202 | ATS adapters и production probe для текущего provider subset | Personio/provider coverage остаётся неполной |
| B223 / PRB-032/034 | Candidate-scoped boundaries и честные unsupported состояния | Полный live contact discovery, MX/SMTP и provider receipts ещё не закрыты |
| B224 / PRB-030/033/037 | Fail-closed `not_scanned`, candidate-scoped audit/deletion/export boundaries | Внешние retrieval adapters и receipts ещё не закрыты |
| B225 / PRB-029/031/035 | State/receipt safeguards и unsupported path | Provider-confirmed LinkedIn write/outreach adapter ещё не готов |
| Desktop auth/app | Missing-session → login, bounded native session checks, login/register timeout, rebuilt `.app` | Production external availability и owner acceptance остаются отдельными runtime gates |

## Evidence

- Local targeted tests after the lazy restore correction: 24/24 профильных теста.
- Full CI for the final commit: workflow `35461714371`, Verify и Deploy —
  успешно; audit, lint, unit tests, coverage, typecheck, build и Chromium E2E
  прошли.
- Production exact release: `9bb256c73472ddcf05b8c045354fa06f421be9c7`.
- Origin после warm-up: `/health` HTTP 200 примерно за 1–2 мс, `/vacancies`
  HTTP 200 примерно за 22 мс.
- `eterapy-3`: `/health` 200 за ~0,35 с, `/vacancies` 200 за ~0,41 с.
- `eterapy-4`: `/health` 200 за ~0,06 с, `/vacancies` 200 за ~0,04 с.
- В production journal зафиксировано `vacancy-pool-ready` с
  `mode=lazy-read`, `clusters=deferred`, `sourceSync=paused`.

## Что ещё нельзя считать готовым

- `/vacancies/page/2` пока не является полноценной cursor/page projection:
  emergency bounded route обслуживает первую страницу. Это не следует выдавать
  за каталог на 10+ млн записей.
- Facets, total count и sitemap пока не питаются из отдельной компактной
  `catalog_entries` projection.
- Source sync/recluster paused до bounded maintenance worker; существующий
  persisted catalog читается, но ingest не объявляется полностью работающим.
- `OFFSET` не является окончательным решением для глубоких страниц; нужен
  keyset cursor по `(last_seen, id)`.

## Следующий срез для новой сессии

1. Создать materialized `catalog_entries` projection: slug, title, company,
   role, place, remote, status, first_seen, last_seen, source_count.
2. Добавить индексы и SQL `COUNT`/facets; исключить parsing cluster JSON из
   public request.
3. Реализовать keyset cursor pagination, корректные page 2+, listing routes и
   sitemap limits.
4. Вынести restore/prune/recluster/source sync в отдельный bounded worker с
   checkpoint, batch size, backpressure и измерением p95/heap/RSS.
5. После этого вернуть source sync по одной bounded волне и подтвердить
   production ingest отдельно от read-only catalog acceptance.

## Definition of done для B229

- [x] Production не гидратирует весь `vacancy_clusters` на startup, health или source-health.
- [x] Public catalog page bounded и отвечает после warm-up на origin, eterapy-3 и eterapy-4.
- [x] Exact-SHA CI Verify/Deploy и production health подтверждены.
- [ ] `catalog_entries` projection с SQL facets/counts.
- [ ] Keyset pagination для page 2+ и listing/sitemap.
- [ ] Отдельный bounded maintenance worker и подтверждённый source-sync resume.
- [ ] Отдельный production memory/p95 report после включения maintenance.
