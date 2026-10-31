import SwiftUI
import WebKit

/// Вход в сервис во встроенном окне. Яндекс: токен из адреса после редиректа; SoundCloud: cookie oauth_token;
/// VK: id из window.vk на странице. Пароль к нам не попадает, всё остаётся на устройстве.
struct LoginView: View {
    let source: String
    let done: (Bool) -> Void
    @EnvironmentObject var repo: Repo
    @State private var loading = true

    var body: some View {
        NavigationStack {
            LoginWeb(source: source, loading: $loading) { result in
                Task {
                    switch result {
                    case .yandex(let t): await repo.setYandexToken(t)
                    case .sc(let t): await repo.setScToken(t)
                    case .vk(let uid, let origin): await repo.setVk(uid: uid, origin: origin)
                    }
                    done(true)
                }
            }
            .ignoresSafeArea(edges: .bottom)
            .navigationTitle("Вход: \(Source.name(source))")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Закрыть") { done(false) } }
                if loading { ToolbarItem(placement: .primaryAction) { ProgressView() } }
            }
        }
    }
}

enum LoginResult { case yandex(String), sc(String), vk(Int, String) }

struct LoginWeb: UIViewRepresentable {
    let source: String
    @Binding var loading: Bool
    let finish: (LoginResult) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()
        let w = WKWebView(frame: .zero, configuration: cfg)
        w.navigationDelegate = context.coordinator
        w.backgroundColor = .black
        switch source {
        case Source.vk:
            // десктопная версия сайта (в мобильной нет window.vk.id), тот же UA, что у запросов VkAPI
            w.customUserAgent = VkAPI.ua
            w.load(URLRequest(url: URL(string: "https://vk.com/login")!))
        case Source.sc:
            w.customUserAgent = ScAPI.loginUA
            w.load(URLRequest(url: URL(string: "https://soundcloud.com/signin")!))
        default:
            w.load(URLRequest(url: URL(string: YandexAPI.oauthURL)!))
        }
        context.coordinator.web = w
        context.coordinator.startTimer()
        return w
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) { coordinator.timer?.invalidate() }

    final class Coordinator: NSObject, WKNavigationDelegate {
        let parent: LoginWeb
        weak var web: WKWebView?
        var timer: Timer?
        var done = false

        init(_ p: LoginWeb) { parent = p }

        func startTimer() {
            guard parent.source != Source.ya else { return }
            timer = Timer.scheduledTimer(withTimeInterval: 1.2, repeats: true) { [weak self] _ in self?.check() }
        }

        private func finish(_ r: LoginResult) {
            guard !done else { return }
            done = true
            timer?.invalidate()
            DispatchQueue.main.async { self.parent.finish(r) }
        }

        func checkURL(_ url: URL?) -> Bool {
            guard parent.source == Source.ya, let frag = url?.fragment, frag.contains("access_token=") else { return false }
            let token = frag.split(separator: "&").first { $0.hasPrefix("access_token=") }?.dropFirst("access_token=".count)
            guard let token, !token.isEmpty else { return false }
            finish(.yandex(String(token).removingPercentEncoding ?? String(token)))
            return true
        }

        func check() {
            guard !done, let w = web else { return }
            if parent.source == Source.sc {
                w.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
                    if let c = cookies.first(where: { $0.name == "oauth_token" && $0.domain.contains("soundcloud") }), !c.value.isEmpty {
                        self?.finish(.sc(c.value.removingPercentEncoding ?? c.value))
                    }
                }
            } else if parent.source == Source.vk {
                w.evaluateJavaScript("JSON.stringify({ uid: (window.vk && Number(window.vk.id)) || 0, origin: location.origin })") { [weak self] res, _ in
                    guard let s = res as? String, let o = parseJSON(s) as? JSON else { return }
                    let uid = o.int("uid")
                    guard uid > 0 else { return }
                    var origin = o.str("origin") ?? "https://vk.com"
                    if origin.range(of: "^https://([a-z0-9-]+\\.)?vk\\.(com|ru)$", options: .regularExpression) == nil { origin = "https://vk.com" }
                    origin = origin.replacingOccurrences(of: "//m.", with: "//").replacingOccurrences(of: "//new.", with: "//")
                    self?.finish(.vk(uid, origin))
                }
            }
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            decisionHandler(checkURL(navigationAction.request.url) ? .cancel : .allow)
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            parent.loading = true
            _ = checkURL(webView.url)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.loading = false
            if !checkURL(webView.url) { check() }
        }
    }
}

/// Вход в аккаунт Nyao через Telegram: ссылка открывается в Safari, а мы опрашиваем сервер
struct NyaoLoginView: View {
    let done: () -> Void
    @EnvironmentObject var repo: Repo
    @Environment(\.openURL) private var openURL
    @State private var status = "Открываем Telegram…"
    @State private var task: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "paperplane.circle.fill").font(.system(size: 64)).foregroundStyle(Color(hex: "#2AABEE"))
            Text("Вход через Telegram").font(Nyao.title(22))
            Text(status).font(.system(size: 15)).foregroundStyle(Nyao.muted).multilineTextAlignment(.center)
            ProgressView()
            Button("Отмена") { task?.cancel(); done() }.padding(.top, 8)
        }
        .padding(32)
        .onAppear {
            task = Task {
                do {
                    let (id, url) = try await repo.cloud.startLogin()
                    openURL(url)
                    status = "Подтверди вход в Telegram и возвращайся сюда"
                    for _ in 0..<150 {
                        try await Task.sleep(nanoseconds: 2_000_000_000)
                        if let u = try await repo.cloud.poll(id) {
                            repo.cloudUser = u
                            repo.show("Привет, \(u.name)!")
                            done()
                            return
                        }
                    }
                    status = "Время вышло — попробуй ещё раз"
                } catch is CancellationError {
                } catch {
                    status = error.localizedDescription
                }
            }
        }
        .onDisappear { task?.cancel() }
    }
}
