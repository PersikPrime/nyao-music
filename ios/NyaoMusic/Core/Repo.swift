import Foundation
import SwiftUI

/// Всё приложение: сервисы, входы, медиатека и волна. Экраны читают отсюда.
@MainActor
final class Repo: ObservableObject {
    static let shared = Repo()

    let ya = YandexAPI()
    let vk = VkAPI()
    let sc = ScAPI()
    let cloud = NyaoCloud()
    let prefs = Prefs.shared

    @Published var accounts: [String: Account] = [:]
    @Published var cloudUser: CloudUser?
    @Published var liked: [Track] = []
    @Published var likedIds = Set<String>()
    @Published var playlists: [Playlist] = []
    @Published var recent: [Track] = []
    @Published var libraryLoading = false
    @Published var toast: String?

    private init() {
        cloudUser = cloud.user
    }

    func loggedIn(_ source: String) -> Bool {
        switch source {
        case Source.ya: return ya.loggedIn
        case Source.vk: return vk.loggedIn
        case Source.sc: return sc.loggedIn
        default: return false
        }
    }

    var anyService: Bool { Source.all.contains { loggedIn($0) } }

    func show(_ text: String) {
        toast = text
        Task { try? await Task.sleep(nanoseconds: 3_500_000_000); if toast == text { toast = nil } }
    }

    // MARK: входы

    func refreshAccounts() async {
        var acc: [String: Account] = [:]
        if ya.loggedIn, let a = try? await ya.account() { acc[Source.ya] = a }
        if vk.loggedIn { acc[Source.vk] = vk.account() }
        if sc.loggedIn, let a = try? await sc.account() { acc[Source.sc] = a }
        accounts = acc
        cloudUser = cloud.user
    }

    func setYandexToken(_ t: String) async {
        prefs.yandexToken = t
        ya.reset()
        await refreshAccounts()
        await loadLibrary()
    }

    func setScToken(_ t: String) async {
        prefs.scToken = t
        sc.reset()
        await refreshAccounts()
        await loadLibrary()
    }

    func setVk(uid: Int, origin: String) async {
        prefs.vkUid = uid
        prefs.vkOrigin = origin
        vk.reset()
        await refreshAccounts()
        await loadLibrary()
    }

    func logout(_ source: String) async {
        switch source {
        case Source.ya: prefs.yandexToken = nil; ya.reset()
        case Source.vk: prefs.vkUid = nil; vk.reset(); await WebCookies.clear(domains: ["vk.com", "vk.ru"])
        case Source.sc: prefs.scToken = nil; sc.reset(); await WebCookies.clear(domains: ["soundcloud"])
        default: break
        }
        accounts[source] = nil
        liked.removeAll { $0.source == source }
        likedIds = Set(liked.map(\.id))
        playlists.removeAll { $0.source == source }
    }

    // MARK: медиатека

    func loadLibrary() async {
        libraryLoading = true
        defer { libraryLoading = false }
        recent = await History.shared.recent(limit: 16)
        async let y: [Track] = ya.loggedIn ? ((try? await ya.likedTracks(limit: 3000)) ?? []) : []
        async let v: [Track] = vk.loggedIn ? ((try? await vk.likedTracks(limit: 2000)) ?? []) : []
        async let s: [Track] = sc.loggedIn ? ((try? await sc.likedTracks(limit: 2000)) ?? []) : []
        async let yp: [Playlist] = ya.loggedIn ? ((try? await ya.playlists()) ?? []) : []
        async let vp: [Playlist] = vk.loggedIn ? ((try? await vk.playlists()) ?? []) : []
        async let sp: [Playlist] = sc.loggedIn ? ((try? await sc.playlists()) ?? []) : []
        let (ly, lv, ls) = await (y, v, s)
        // по дате лайка, если она есть у всех; иначе чередуем сервисы
        let all = ly + lv + ls
        liked = all.allSatisfy({ $0.likedAt > 0 }) ? all.sorted { $0.likedAt > $1.likedAt } : alternateAll([ly, lv, ls])
        likedIds = Set(liked.map(\.id))
        playlists = await yp + vp + sp
    }

    func playlistTracks(_ p: Playlist) async throws -> [Track] {
        switch p.source {
        case Source.ya: return p.id.hasPrefix("yaalbum:") ? try await ya.albumTracks(p.id) : try await ya.playlistTracks(p.id)
        case Source.vk: return try await vk.playlistTracks(p.id)
        case Source.sc: return try await sc.playlistTracks(p.id)
        default: return []
        }
    }

    func toggleLike(_ t: Track) async {
        let on = !likedIds.contains(t.id)
        do {
            switch t.source {
            case Source.ya: try await ya.like(t, on)
            case Source.vk: try await vk.like(t, on)
            case Source.sc: try await sc.like(t.srcId, on)
            default: throw ApiError("Лайки этого сервиса пока не поддерживаются на iOS")
            }
            if on { likedIds.insert(t.id); liked.insert(t, at: 0) } else { likedIds.remove(t.id); liked.removeAll { $0.id == t.id } }
            if t.source == Source.ya, ya.loggedIn { await ya.waveFeedback(on ? "like" : "unlike", track: t) }
        } catch {
            show(error.localizedDescription)
        }
    }

    // MARK: поиск

    func search(_ q: String) async -> [String: [Track]] {
        async let y: [Track] = ya.loggedIn ? ((try? await ya.search(q)) ?? []) : []
        async let v: [Track] = vk.loggedIn ? ((try? await vk.search(q)) ?? []) : []
        // SoundCloud ищет и без входа
        async let s: [Track] = (try? await sc.search(q)) ?? []
        return await [Source.ya: y, Source.vk: v, Source.sc: s]
    }

    // MARK: волна

    private var waveIds = Set<String>()

    func waveStart() async -> [Track] {
        waveIds = []
        let exclude = await History.shared.recentIds()
        let srcs = prefs.waveSources
        let mood = prefs.waveMood, div = prefs.waveDiversity == "default" ? nil : prefs.waveDiversity
        async let y: [Track] = (ya.loggedIn && srcs.contains(Source.ya)) ? ((try? await ya.waveStart(diversity: div, mood: mood)) ?? []) : []
        async let v: [Track] = (vk.loggedIn && srcs.contains(Source.vk)) ? await vk.wavePool(exclude: exclude, size: 10) : []
        async let s: [Track] = (sc.loggedIn && srcs.contains(Source.sc)) ? await sc.wavePool(exclude: exclude, size: 10) : []
        let mixed = alternateAll([await y, await v, await s]).filter { $0.available && !exclude.contains($0.id) || $0.source == Source.ya }
        if ya.loggedIn { await ya.waveFeedback("radioStarted", track: nil) }
        return dedupe(mixed)
    }

    func waveMore(queue: [Track]) async -> [Track] {
        let exclude = await History.shared.recentIds().union(queue.map(\.id))
        let srcs = prefs.waveSources
        let mood = prefs.waveMood, div = prefs.waveDiversity == "default" ? nil : prefs.waveDiversity
        async let y: [Track] = (ya.loggedIn && srcs.contains(Source.ya)) ? ((try? await ya.waveMore(queueIds: queue.map(\.id), diversity: div, mood: mood)) ?? []) : []
        async let v: [Track] = (vk.loggedIn && srcs.contains(Source.vk)) ? await vk.wavePool(exclude: exclude, size: 6) : []
        async let s: [Track] = (sc.loggedIn && srcs.contains(Source.sc)) ? await sc.wavePool(exclude: exclude, size: 6) : []
        return dedupe(alternateAll([await y, await v, await s]).filter { !exclude.contains($0.id) })
    }

    private func dedupe(_ list: [Track]) -> [Track] {
        var out: [Track] = []
        for t in list where waveIds.insert(t.id).inserted { out.append(t) }
        return out
    }

    /// Радио по треку: Яндекс — своя станция, SoundCloud — «похожие», VK — рекомендации
    func radio(from t: Track) async -> [Track] {
        switch t.source {
        case Source.ya: return (try? await ya.radioStart(trackId: t.srcId)) ?? []
        case Source.sc: return (try? await sc.related(t.srcId)) ?? []
        case Source.vk: return (try? await vk.recommendations())?.shuffled() ?? []
        default: return []
        }
    }

    func radioMore(source: String, queue: [Track]) async -> [Track] {
        let ids = Set(queue.map(\.id))
        switch source {
        case Source.ya: return ((try? await ya.radioMore(queueIds: queue.map(\.id))) ?? []).filter { !ids.contains($0.id) }
        case Source.sc:
            guard let last = queue.last else { return [] }
            return ((try? await sc.related(last.srcId)) ?? []).filter { !ids.contains($0.id) }
        default: return []
        }
    }

    // MARK: звук

    func streamURL(_ t: Track) async throws -> URL {
        switch t.source {
        case Source.ya: return try await ya.streamURL(t.srcId)
        case Source.vk: return try await vk.streamURL(t.srcId)
        case Source.sc: return try await sc.hlsURL(t.srcId)
        default: throw ApiError("\(Source.name(t.source)) пока не играет на iPhone — скоро")
        }
    }

    /// Ссылка перестала работать — в следующий раз спросим новую
    func forgetStream(_ t: Track) {
        if t.source == Source.vk { vk.forget(t.srcId) }
        if t.source == Source.sc { sc.forget(t.srcId) }
    }
}
