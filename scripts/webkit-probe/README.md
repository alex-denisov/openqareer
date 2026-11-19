# webkit-probe — замер экрана в движке .app

Окно .app (Tauri) рисует системный WebKit macOS. Safari и Playwright WebKit новее
и не повторяют его ошибок: в #779 логические сокращения с `var()` ломали отступы только в .app.
Проба открывает страницу в WKWebView внутри невидимого окна. Окно не выводится
на экран и не забирает фокус, поэтому экран владельца не захватывается.

Нужны macOS и `swiftc` (Xcode Command Line Tools). Бинарник собирается при первом
вызове в `node_modules/.cache/webkit-probe/` и пересобирается, если `probe.swift` новее.

## Вызов

```bash
node scripts/webkit-probe.mjs --url <адрес|путь> --width 1440 \
  --selector '.main' --selector '.btn-primary' \
  --wait-for '[data-b640-node]' --png shot.png --full-page --out shot.json
```

| Флаг | Что делает |
|------|-----------|
| `--url` | `http(s)://…`, `file://…` или путь к файлу |
| `--width`, `--height` | окно, по умолчанию 1440×900 |
| `--selector` | что мерить, можно повторять; до 50 совпадений на селектор |
| `--wait-for` | ждать элемент перед замером (таймаут `--timeout`, 20 с) |
| `--settle` | пауза после готовности, 500 мс |
| `--png`, `--full-page` | снимок окна или всего документа; масштаб экрана ×2 |
| `--session <токен>` | cookie `openqareer_session` для домена адреса, без пароля |
| `--cookie name=value` | любая cookie для домена адреса |
| `--theme light\|dark` | `oq_b640_theme` в localStorage до загрузки |
| `--local-storage k=v` | другие записи localStorage |
| `--init-script <файл>` | JS до скриптов страницы, например заглушки `fetch` для фикстуры |
| `--out` | JSON в файл, иначе в stdout |

Выход:

```json
{ "userAgent": "…", "location": "…", "viewport": {"width": 390, "height": 900}, "documentHeight": 2118,
  "elements": { ".btn-primary": [ { "text": "Собрать план",
    "rect": {"x": 16, "y": 712, "width": 358, "height": 48},
    "computed": {"display": "flex", "padding": "0px 20px", "margin": "0px", "gap": "8px",
      "fontFamily": "…", "fontSize": "16px", "fontWeight": "600", "lineHeight": "24px",
      "color": "…", "backgroundColor": "…", "borderRadius": "12px", "borderWidth": "0px", "borderColor": "…"} } ] } }
```

`rect.y` считается от начала документа. Селектор без совпадений даёт пустой массив,
ошибочный селектор даёт `{ "error": "…" }`.

## Три способа открыть экран

1. **Прод с сессией.** Токен берётся из cookie уже вошедшей сессии; пароль проба не вводит.
   `--url https://openqareer.com/app/career --session <токен>`
2. **Локальная сборка.** `npx vite build && npx vite preview --port 4391`, затем
   `--url http://127.0.0.1:4391/app/…`. Для данных без сервера подключите
   `--init-script` с подменой `window.fetch` из фикстуры e2e.
3. **Файл.** HTML-макет из `mockups/…` открывается путём, без сервера:
   `--url mockups/d01-workplace/screens/d01g-mesto-raboty.html`. Для `file://` localStorage
   недоступен, поэтому тему задавайте через адрес или `--init-script`.
