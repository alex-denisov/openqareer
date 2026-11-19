// Замер экрана в системном WebKit macOS — том же движке, что окно Tauri в .app.
// Safari и Playwright WebKit новее и не повторяют его ошибок (#779), поэтому
// вёрстку .app сверяют здесь. WKWebView живёт в невидимом NSWindow, которое
// никогда не выводится на экран: экран владельца не захватывается.
//
// Вход — JSON на stdin (собирает scripts/webkit-probe.mjs), выход — JSON на stdout.
import AppKit
import Foundation
import WebKit

struct Cookie: Decodable {
  let name: String
  let value: String
  let domain: String
}

struct Config: Decodable {
  let url: String
  let width: Int
  let height: Int
  let selectors: [String]
  let waitFor: String?
  let settleMs: Int
  let timeoutMs: Int
  let png: String?
  let fullPage: Bool
  let cookies: [Cookie]
  let localStorage: [String: String]
  let initScript: String?
}

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data(("webkit-probe: " + message + "\n").utf8))
  exit(1)
}

let input = FileHandle.standardInput.readDataToEndOfFile()
guard let parsed = try? JSONDecoder().decode(Config.self, from: input) else { fail("неверный JSON на входе") }
guard let parsedTarget = URL(string: parsed.url) else { fail("неверный URL \(parsed.url)") }

/// Сбор в странице: rect и вычисленные стили каждого совпадения селектора.
let collectScript = """
(selectors) => {
  const round = (value) => Math.round(value * 10) / 10;
  const pick = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return {
      text: (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
      rect: { x: round(r.x + scrollX), y: round(r.y + scrollY), width: round(r.width), height: round(r.height) },
      computed: {
        display: s.display, padding: s.padding, margin: s.margin, gap: s.gap,
        fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight,
        color: s.color, backgroundColor: s.backgroundColor, borderRadius: s.borderRadius,
        borderWidth: s.borderWidth, borderColor: s.borderColor,
      },
    };
  };
  const elements = {};
  for (const selector of selectors) {
    try { elements[selector] = [...document.querySelectorAll(selector)].slice(0, 50).map(pick); }
    catch (error) { elements[selector] = { error: String(error) }; }
  }
  return JSON.stringify({
    userAgent: navigator.userAgent,
    location: location.href,
    viewport: { width: innerWidth, height: innerHeight },
    documentHeight: document.documentElement.scrollHeight,
    elements,
  });
}
"""

func jsString(_ value: String) -> String {
  let data = try! JSONSerialization.data(withJSONObject: [value])
  return String(String(decoding: data, as: UTF8.self).dropFirst().dropLast())
}

final class Probe: NSObject, WKNavigationDelegate {
  let config: Config
  let target: URL
  let view: WKWebView
  let window: NSWindow
  var started = Date()

  init(config: Config, target: URL) {
    self.config = config
    self.target = target
    let controller = WKUserContentController()
    let storage = config.localStorage
      .map { key, value in "try{localStorage.setItem(\(jsString(key)),\(jsString(value)))}catch(e){}" }
      .joined(separator: ";")
    if !storage.isEmpty {
      controller.addUserScript(WKUserScript(source: storage, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
    if let script = config.initScript {
      controller.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
    let configuration = WKWebViewConfiguration()
    configuration.userContentController = controller
    configuration.websiteDataStore = .nonPersistent()
    let frame = NSRect(x: 0, y: 0, width: config.width, height: config.height)
    view = WKWebView(frame: frame, configuration: configuration)
    // Снимку нужен вид внутри окна; окно не выводится (orderFront не вызывается).
    window = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
    window.contentView = view
    super.init()
    view.navigationDelegate = self
  }

  func start() {
    let store = view.configuration.websiteDataStore.httpCookieStore
    let group = DispatchGroup()
    for cookie in config.cookies {
      let properties: [HTTPCookiePropertyKey: Any] = [
        .name: cookie.name, .value: cookie.value, .domain: cookie.domain, .path: "/", .secure: "TRUE",
      ]
      guard let http = HTTPCookie(properties: properties) else { fail("неверная cookie \(cookie.name)") }
      group.enter()
      store.setCookie(http) { group.leave() }
    }
    group.notify(queue: .main) {
      self.started = Date()
      if self.target.isFileURL {
        self.view.loadFileURL(self.target, allowingReadAccessTo: self.target.deletingLastPathComponent())
      } else {
        self.view.load(URLRequest(url: self.target))
      }
    }
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { waitForReady() }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    fail("страница не загрузилась: \(error.localizedDescription)")
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    fail("страница не загрузилась: \(error.localizedDescription)")
  }

  func waitForReady() {
    guard let selector = config.waitFor else { return settle() }
    view.evaluateJavaScript("document.querySelector(\(jsString(selector))) !== null") { result, _ in
      if (result as? Bool) == true { return self.settle() }
      if Date().timeIntervalSince(self.started) * 1000 > Double(self.config.timeoutMs) {
        fail("за \(self.config.timeoutMs) мс не появился \(selector)")
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { self.waitForReady() }
    }
  }

  func settle() {
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(config.settleMs)) { self.collect() }
  }

  func collect() {
    let selectors = String(decoding: try! JSONSerialization.data(withJSONObject: config.selectors), as: UTF8.self)
    view.evaluateJavaScript("(\(collectScript))(\(selectors))") { result, error in
      guard let json = result as? String else { fail("сбор не удался: \(String(describing: error))") }
      guard let png = self.config.png else {
        print(json)
        exit(0)
      }
      self.snapshot(json: json, to: png)
    }
  }

  func snapshot(json: String, to path: String) {
    let height = config.fullPage ? max(config.height, documentHeight(json)) : config.height
    let size = NSSize(width: config.width, height: height)
    window.setContentSize(size)
    view.setFrameSize(size)
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
      let snapshot = WKSnapshotConfiguration()
      snapshot.rect = NSRect(origin: .zero, size: size)
      self.view.takeSnapshot(with: snapshot) { image, error in
        guard let image, let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
              let data = bitmap.representation(using: .png, properties: [:]) else {
          fail("снимок не получился: \(String(describing: error))")
        }
        do { try data.write(to: URL(fileURLWithPath: path)) } catch { fail("не записать \(path)") }
        print(json)
        exit(0)
      }
    }
  }
}

func documentHeight(_ json: String) -> Int {
  guard let object = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
        let height = object["documentHeight"] as? Int else { return 0 }
  return height
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let probe = Probe(config: parsed, target: parsedTarget)
probe.start()
DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(parsed.timeoutMs + 10_000)) { fail("общий таймаут") }
app.run()
