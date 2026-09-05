#!/usr/bin/env python3
"""B199 — живая проба каждого адреса из `vacancy-source-candidates.json`.

Инструмент исследования, а не часть продукта: он ничего не подключает и ничего
не пишет в базу. Он отвечает ровно на один вопрос по каждому адресу — что этот
адрес отдал **этому маршруту** прямо сейчас, и разрешает ли его `robots.txt` то,
что мы собираемся делать.

Маршрут называется в отчёте явно, потому что «не ответил» с российского
маршрута и «не ответил никому» — разные факты. ТрудВсем отвечает из России и
молчит из EU; telegra.ph наоборот; а часть зарубежных хостов обрывает тело на
16–20 КБ именно на домашнем канале владельца (INC-036).

Только стандартная библиотека плюс curl: на прод-VM нет ни Node, ни pip.

    python3 scripts/probe_vacancy_sources.py --route=eu-prod
    python3 scripts/probe_vacancy_sources.py --route=ru-dc --only=owner-companies
"""

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit

AGENT = "openqareer-source-probe/1.0 (+https://openqareer.com; research probe, one request per address)"
BROWSER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
CONNECT_TIMEOUT = 12
MAX_TIME = 45
HERE = os.path.dirname(os.path.abspath(__file__))

# curl(1): 6 = хост не разрешается, 7 = соединение отвергнуто, 28 = вышло время,
# 35/60 = TLS. Каждый из них — свой факт, и сводить их в «не ответил» нельзя.
CURL_MEANING = {
    6: "dns-not-resolved",
    7: "connection-refused",
    28: "timeout",
    35: "tls-failed",
    60: "tls-cert-rejected",
    52: "empty-reply",
    56: "connection-reset",
}


def request(url, agent):
    """Одна попытка. Возвращает и тело, и то, как именно попытка кончилась."""
    started = time.time()
    proc = subprocess.run(
        [
            "curl", "-sS", "-L", "--max-redirs", "5",
            "--connect-timeout", str(CONNECT_TIMEOUT),
            "--max-time", str(MAX_TIME),
            "-A", agent,
            "-H", "Accept: */*",
            "-H", "Accept-Language: en,ru;q=0.8",
            "-w", "\n@@META %{http_code} %{size_download} %{time_connect} %{url_effective}",
            "--", url,
        ],
        capture_output=True,
        timeout=MAX_TIME + 20,
    )
    elapsed = int((time.time() - started) * 1000)
    text = proc.stdout.decode("utf-8", "replace")
    body, _, meta = text.rpartition("\n@@META ")
    status, size, connect_s, final_url = 0, 0, 0.0, url
    if meta:
        parts = meta.split(" ", 3)
        try:
            status, size, connect_s = int(parts[0]), int(parts[1]), float(parts[2])
            final_url = parts[3].strip() if len(parts) > 3 else url
        except (ValueError, IndexError):
            pass
    if proc.returncode == 0:
        return {"status": status, "body": body, "bytes": size, "ms": elapsed,
                "finalUrl": final_url, "failure": None, "error": None}
    reason = CURL_MEANING.get(proc.returncode, f"curl-{proc.returncode}")
    # Время вышло, но байты шли и соединение встало — тело оборвалось на
    # середине. Это факт о маршруте, а не о жизни площадки (INC-036).
    if proc.returncode == 28 and connect_s > 0 and len(body) > 0:
        failure = "body-stalled"
    elif proc.returncode == 28 and connect_s == 0:
        failure = "unreachable"
    elif proc.returncode in (6, 7):
        failure = "address-lost" if proc.returncode == 6 else "unreachable"
    else:
        failure = "unreachable"
    return {"status": status, "body": body, "bytes": len(body.encode()), "ms": elapsed,
            "finalUrl": final_url, "failure": failure, "error": reason}


def robots_verdict(body, status, url_path):
    """Разбор robots.txt в духе RFC 9309, сознательно осторожный.

    Побеждает самое длинное совпадение, при равной длине — запрет. `404` —
    это отсутствие политики, то есть разрешение. Любой другой сбой чтения
    оставляет разрешение неподтверждённым: мы не считаем молчание согласием.
    """
    if status == 404:
        return {"verdict": "no-policy", "detail": "robots.txt отсутствует", "signals": []}
    if status != 200 or not isinstance(body, str) or not body.strip():
        return {"verdict": "unconfirmed", "detail": f"robots.txt недоступен ({status})", "signals": []}
    groups, current = [], None
    for raw in body.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or ":" not in line:
            continue
        field, _, value = line.partition(":")
        field, value = field.strip().lower(), value.strip()
        if field == "user-agent":
            if current is None or current["rules"]:
                current = {"agents": [], "rules": [], "signals": []}
                groups.append(current)
            current["agents"].append(value.lower())
        elif current is not None and field in ("allow", "disallow"):
            current["rules"].append({"allow": field == "allow", "path": value})
        elif current is not None and field == "content-signal":
            current["signals"].append(value)
    relevant = [g for g in groups if any(a in ("*", "openqareer-source-probe") for a in g["agents"])]
    if not relevant:
        return {"verdict": "no-policy", "detail": "нет группы для нашего агента", "signals": []}
    signals = [s for g in relevant for s in g["signals"]]
    best = None
    for group in relevant:
        for rule in group["rules"]:
            if rule["path"] == "" and not rule["allow"]:
                continue
            if not url_path.startswith(rule["path"]):
                continue
            if (best is None
                    or len(rule["path"]) > len(best["path"])
                    or (len(rule["path"]) == len(best["path"]) and not rule["allow"])):
                best = rule
    if best is None:
        return {"verdict": "allowed", "detail": "правило не совпало", "signals": signals}
    word = "Allow" if best["allow"] else "Disallow"
    return {"verdict": "allowed" if best["allow"] else "disallowed",
            "detail": f"{word}: {best['path']}", "signals": signals}


def shape_of(body, content_type=""):
    """Чем тело оказалось на самом деле, независимо от того, что обещал адрес."""
    if not body:
        return "empty"
    head = body[:400].lstrip().lower()
    if head.startswith("<?xml") or head.startswith("<rss") or head.startswith("<feed"):
        return "feed"
    if head.startswith("{") or head.startswith("["):
        return "json"
    if head.startswith("<!doctype html") or head.startswith("<html"):
        has_cards = any(w in body.lower() for w in ("job", "vacanc", "position")) and len(body) > 40_000
        return "html-with-content" if has_cards else "html-shell"
    if "json" in content_type:
        return "json"
    return "unknown"


def count_items(body, shape):
    """Сколько записей реально пришло — считается из тела, а не из обещания."""
    try:
        if shape == "feed":
            return body.count("<item>") + body.count("<item ") + body.count("<entry>") + body.count("<entry ")
        if shape == "json":
            parsed = json.loads(body)
            if isinstance(parsed, list):
                return len(parsed)
            for key in ("jobs", "results", "data", "offers", "content", "postings", "items"):
                value = parsed.get(key) if isinstance(parsed, dict) else None
                if isinstance(value, list):
                    return len(value)
    except (ValueError, AttributeError):
        return None
    return None


def main():
    args = {}
    for raw in sys.argv[1:]:
        key, _, value = raw.lstrip("-").partition("=")
        args[key] = value or "true"
    route = args.get("route", "unnamed-route")
    only = args.get("only")
    catalog_path = args.get("catalog", os.path.join(HERE, "vacancy-source-candidates.json"))
    out_path = args.get("out", f"probe-{route}-{datetime.now(timezone.utc):%Y-%m-%d}.json")

    with open(catalog_path, encoding="utf-8") as handle:
        candidates = json.load(handle)
    if only:
        candidates = [c for c in candidates if c["group"] == only or c["id"] == only]

    robots_cache, results = {}, []
    for candidate in candidates:
        split = urlsplit(candidate["url"])
        origin = f"{split.scheme}://{split.netloc}"
        if origin not in robots_cache:
            robots_cache[origin] = request(f"{origin}/robots.txt", AGENT)
        cached = robots_cache[origin]
        robots = robots_verdict(cached["body"], cached["status"], split.path or "/")

        # Сначала честный агент. Браузерный User-Agent — только вторая попытка
        # и только там, где robots.txt не сказал «нет»: обойти отказ площадки
        # не наша задача, она решается браузерной сессией кандидата (B206).
        response = request(candidate["url"], AGENT)
        used_agent = "probe"
        if response["status"] == 403 and robots["verdict"] != "disallowed":
            response = request(candidate["url"], BROWSER_AGENT)
            used_agent = "browser"

        shape = shape_of(response["body"]) if response["body"] else "none"
        items = count_items(response["body"], shape) if response["body"] else None
        record = {
            "id": candidate["id"], "group": candidate["group"], "expected": candidate["kind"],
            "url": candidate["url"], "route": route,
            "observedAt": datetime.now(timezone.utc).isoformat(),
            "status": response["status"], "failure": response["failure"], "error": response["error"],
            "ms": response["ms"], "bytes": response["bytes"],
            "redirected": response["finalUrl"] if response["finalUrl"] != candidate["url"] else None,
            "shape": shape, "items": items, "usedAgent": used_agent,
            "robots": robots["verdict"], "robotsDetail": robots["detail"],
            "contentSignals": robots["signals"],
        }
        results.append(record)
        # Порядок важен: оборванное тело нельзя показывать как успешный ответ
        # только потому, что заголовок успел прийти с кодом 200.
        mark = ("~" if record["failure"] == "body-stalled"
                else "✗" if record["failure"]
                else "✓" if record["status"] == 200 and (items or 0) > 0
                else "·" if record["status"] == 200 else "✗")
        print(f"{mark} {candidate['id']:<30} {record['status']:<4} {shape:<18}"
              f"{str(items if items is not None else '—'):>5} {record['robots']:<12}"
              f"{record['bytes']:>8}B {record['ms']}ms {record['error'] or ''}", flush=True)

    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump({"route": route, "generatedAt": datetime.now(timezone.utc).isoformat(),
                   "results": results}, handle, ensure_ascii=False, indent=1)
    print(f"\n{len(results)} адресов, отчёт: {out_path}")


if __name__ == "__main__":
    main()
