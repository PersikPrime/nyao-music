import Foundation
import UIKit

/// Аккаунт Nyao (вход через Telegram): история, «сейчас играет», друзья и профили — перенос NyaoCloud.kt.
/// Токены музыкальных сервисов сюда не попадают.
final class NyaoCloud {
    static let base = "https://api.music.withnyao.app"
    static let legacyBase = "https://api.nmusic.bixtl.cc"
    static let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "100"

    private let prefs = Prefs.shared
    private var baseURL = NyaoCloud.base
    private var lastNowKey = ""
    private var lastNowAt = 0.0

    var loggedIn: Bool { prefs.nyaoToken != nil }

    var user: CloudUser? {
        guard let d = prefs.nyaoUser, let o = parseJSON(d) as? JSON else { return nil }
        return Self.parseUser(o)
    }

    static func parseUser(_ o: JSON) -> CloudUser { CloudUser(name: o.str("name") ?? "Telegram", username: o.str("username"), picture: o.str("picture")) }

    // MARK: запросы

    @discardableResult
    private func request(_ method: String, _ path: String, _ body: JSON? = nil, long: Bool = false) async throws -> JSON {
        do { return try await requestAt(baseURL, method, path, body, long) } catch let e as ApiError { throw e } catch {
            guard baseURL == Self.base else { throw error }
            // новый домен не отвечает (сеть, DNS) — пробуем прежний
            baseURL = Self.legacyBase
            return try await requestAt(baseURL, method, path, body, long)
        }
    }

    private func requestAt(_ b: String, _ method: String, _ path: String, _ body: JSON?, _ long: Bool) async throws -> JSON {
        var req = URLRequest(url: URL(string: b + path)!)
        req.httpMethod = method
        req.setValue("NyaoMusic-iOS", forHTTPHeaderField: "User-Agent")
        req.setValue(Self.build, forHTTPHeaderField: "X-Nyao-Build")
        if let t = prefs.nyaoToken { req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization") }
        if method != "GET" {
            req.httpBody = try JSONSerialization.data(withJSONObject: body ?? [:])
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (code, data, _) = try await Net.send(req, long: long)
        let json = parseJSON(data) as? JSON ?? [:]
        if code == 401 && prefs.nyaoToken != nil { forget() }
        guard (200..<300).contains(code) else { throw ApiError(json.str("error") ?? "Сервер Nyao ответил \(code)", code: code) }
        return json
    }

    private func forget() {
        prefs.nyaoToken = nil
        prefs.nyaoUser = nil
    }

    private static func q(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? s }

    // MARK: вход

    /// Шаг 1: ссылка на Telegram и id для опроса
    func startLogin() async throws -> (id: String, url: URL) {
        let r = try await request("POST", "/auth/start", ["device": await UIDevice.current.name, "platform": "ios"])
        guard let id = r.str("id"), let u = r.str("url").flatMap(URL.init(string:)) else { throw ApiError("Сервер Nyao не дал ссылку на вход") }
        return (id, u)
    }

    /// Шаг 2: подтвердил ли пользователь вход. nil — ещё ждём
    func poll(_ id: String) async throws -> CloudUser? {
        let r = try await request("GET", "/auth/poll?id=\(Self.q(id))")
        if r.str("status") == "error" { throw ApiError(r.str("error") ?? "Вход не удался") }
        guard r.str("status") == "done", let token = r.str("token"), let u = r.obj("user") else { return nil }
        prefs.nyaoToken = token
        prefs.nyaoUser = try? JSONSerialization.data(withJSONObject: u)
        return Self.parseUser(u)
    }

    func logout() async {
        if loggedIn { _ = try? await request("POST", "/auth/logout") }
        forget()
    }

    // MARK: история

    func flush() async {
        guard loggedIn else { return }
        let out = await History.shared.outbox()
        guard !out.isEmpty else { return }
        var sent = 0
        while sent < out.count {
            let chunk = Array(out[sent..<min(sent + 200, out.count)])
            do { try await request("POST", "/history", ["plays": chunk]) } catch { break }
            sent += chunk.count
        }
        if sent > 0 { await History.shared.dropOutbox(sent) }
    }

    // MARK: «сейчас играет»

    static func trackJSON(_ t: Track) -> JSON {
        ["id": t.id, "source": t.source, "srcId": t.srcId, "title": t.title, "artist": t.artist, "album": t.album,
         "albumId": t.albumId ?? NSNull(), "duration": t.duration, "cover": t.cover ?? NSNull()]
    }

    static func parseTrack(_ t: JSON?) -> Track? {
        guard let t, let id = t.str("id"), let src = t.str("srcId") else { return nil }
        return Track(id: id, source: t.str("source") ?? String(id.prefix { $0 != ":" }), srcId: src, title: t.str("title") ?? "",
                     artist: t.str("artist") ?? "", album: t.str("album") ?? "", albumId: t.str("albumId"), duration: t.int("duration"), cover: t.str("cover"))
    }

    /// Смену трека и паузу шлём сразу, остальное — не чаще раза в 20 секунд
    func setNow(_ t: Track?, position: Double, playing: Bool, context: String, force: Bool = false) async {
        guard loggedIn else { return }
        let key = "\(t?.id ?? "-")|\(playing)"
        let now = nowMs()
        if !force && key == lastNowKey && now - lastNowAt < 20_000 { return }
        lastNowKey = key
        lastNowAt = now
        var body: JSON = ["position": position, "playing": playing, "context": context]
        if let t { body["track"] = Self.trackJSON(t) }
        _ = try? await request("PUT", "/now", body)
    }

    // MARK: друзья и профили

    static func parseCard(_ o: JSON?) -> UserCard? {
        guard let o, let id = o.str("id") else { return nil }
        return UserCard(id: id, nick: o.str("nick") ?? "", name: o.str("name") ?? "", picture: o.str("picture"),
                        shape: o.str("shape") ?? o.str("avatarShape"), color: o.str("color"))
    }

    private static func parseNow(_ o: JSON?) -> FriendNow? {
        guard let o, let t = parseTrack(o.obj("track")) else { return nil }
        return FriendNow(track: t, playing: o.bool("playing"), updatedAt: o.double("updatedAt") ?? 0)
    }

    func friends() async throws -> (friends: [Friend], incoming: [UserCard]) {
        let o = try await request("GET", "/friends")
        let fr = o.objs("friends").compactMap { f in Self.parseCard(f).map { Friend(user: $0, now: Self.parseNow(f.obj("now")), online: f.bool("online")) } }
        return (fr, o.objs("incoming").compactMap { Self.parseCard($0) })
    }

    func acceptFriend(_ id: String) async throws { try await request("POST", "/friends/\(id)/accept") }
    func removeFriend(_ id: String) async throws { try await request("DELETE", "/friends/\(id)") }
    func requestFriend(nick: String) async throws { try await request("POST", "/friends/request", ["nick": nick]) }

    func searchUsers(_ q: String) async throws -> [(UserCard, String)] {
        try await request("GET", "/users/search?q=\(Self.q(q))").objs("users").compactMap { o in Self.parseCard(o).map { ($0, o.str("relation") ?? "none") } }
    }

    func user(_ key: String) async throws -> PublicProfile {
        let o = try await request("GET", "/users/\(Self.q(key))")
        guard let card = Self.parseCard(o) else { throw ApiError("Профиль не найден") }
        let st = o.obj("stats")
        return PublicProfile(
            user: card, relation: o.str("relation") ?? "none", isPrivate: o.bool("private"), bio: o.str("bio") ?? "",
            friends: o.int("friends"), now: Self.parseNow(o.obj("now")),
            badges: o.objs("badges").map { Badge(id: $0.str("id") ?? UUID().uuidString, title: $0.str("title") ?? "", mark: $0.str("mark") ?? $0.str("emoji") ?? "★", tone: $0.str("tone") ?? "accent") },
            banner: o.str("banner"),
            links: o.objs("links").compactMap { l in l.str("url").map { ProfileLink(kind: l.str("kind") ?? "site", url: $0) } },
            statusTrack: Self.parseTrack(o.obj("statusTrack")),
            minutes: st?.int("minutes") ?? 0, plays: st?.int("plays") ?? 0,
            topArtists: (st?.objs("topArtists") ?? []).map { TopArtist(name: $0.str("name") ?? "", plays: $0.int("plays")) })
    }

    func profile() async throws -> MyProfile {
        let o = try await request("GET", "/profile")
        return MyProfile(nick: o.str("nick") ?? "", bio: o.str("bio") ?? "", color: o.str("color"), avatarShape: o.str("avatarShape") ?? "cookie", banner: o.str("banner"))
    }

    func updateProfile(_ changes: JSON) async throws { try await request("PUT", "/profile", changes) }

    func inbox() async throws -> [InboxItem] {
        try await request("GET", "/inbox").objs("items").map { o in
            InboxItem(id: o.str("id") ?? UUID().uuidString, kind: o.str("kind") ?? "", from: Self.parseCard(o.obj("from")), emoji: o.str("emoji"),
                      track: Self.parseTrack(o.obj("track")), read: o.bool("read"), at: o.double("createdAt") ?? nowMs())
        }
    }

    func readInbox() async { _ = try? await request("POST", "/inbox/read", ["all": true]) }

    func react(to friendId: String, emoji: String, track: Track?) async throws {
        var b: JSON = ["emoji": emoji]
        if let track { b["track"] = Self.trackJSON(track) }
        try await request("POST", "/friends/\(friendId)/react", b)
    }

    func share(to: String, track: Track) async throws { try await request("POST", "/share", ["to": to, "track": Self.trackJSON(track)]) }
}
