import Foundation

/// SoundCloud через внутреннее API сайта (api-v2.soundcloud.com) — перенос ScApi.kt.
/// client_id берём из скриптов soundcloud.com, вход — OAuth-токен из cookie oauth_token.
final class ScAPI {
    private static let api = "https://api-v2.soundcloud.com"
    static let loginUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
    static let ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"

    private let prefs = Prefs.shared
    private var clientIdCache: String?
    private var account: (String?, Account)?
    private let lock = NSLock()
    private var rawTracks: [String: JSON] = [:]

    var loggedIn: Bool { !(prefs.scToken ?? "").isEmpty }
    func reset() { account = nil }

    static func bigArtwork(_ url: String?) -> String? { url?.replacing("-(large|t\\d+x\\d+|small|tiny|badge|crop)\\.", with: "-t500x500.") }

    static func mapTrack(_ t: JSON?) -> Track? {
        guard let t, let id = t.str("id") else { return nil }
        if let k = t.str("kind"), k != "track" { return nil }
        let user = t.obj("user")
        let policy = t.str("policy")
        let dur = t["full_duration"] != nil ? t.int("full_duration") : t.int("duration")
        return Track(id: "sc:\(id)", source: Source.sc, srcId: id, title: t.str("title") ?? "Без названия",
                     artist: t.obj("publisher_metadata")?.str("artist") ?? user?.str("username") ?? "SoundCloud",
                     duration: dur / 1000, cover: bigArtwork(t.str("artwork_url") ?? user?.str("avatar_url")),
                     available: policy != "BLOCK" && policy != "SNIP" && t.bool("streamable", true))
    }

    private func getText(_ url: String) async throws -> String {
        var r = URLRequest(url: URL(string: url)!)
        r.setValue(Self.ua, forHTTPHeaderField: "User-Agent")
        let (code, text) = try await Net.text(r)
        guard (200..<300).contains(code) else { throw ApiError("SoundCloud: \(code)", code: code) }
        return text
    }

    /// client_id из JS-бандлов soundcloud.com
    private func clientId(force: Bool = false) async throws -> String {
        if !force, let c = clientIdCache { return c }
        let page = try await getText("https://soundcloud.com/")
        let scripts = page.allMatches("<script[^>]+src=\"(https://a-v2\\.sndcdn\\.com/assets/[^\"]+\\.js)\"").map { $0[1] }.reversed()
        for src in scripts {
            guard let js = try? await getText(src) else { continue }
            if let m = js.firstMatch("client_id\\s*[:=]\\s*\"([A-Za-z0-9]{32})\"") ?? js.firstMatch("client_id=([A-Za-z0-9]{32})") {
                clientIdCache = m
                return m
            }
        }
        throw ApiError("SoundCloud: не удалось получить client_id")
    }

    private func request(_ method: String, _ path: String, query: [String: String] = [:], retry: Bool = true) async throws -> Any? {
        var q = query
        q["client_id"] = try await clientId()
        var req = URLRequest(url: Net.url(path.hasPrefix("http") ? path : Self.api + path, q))
        req.httpMethod = method
        req.setValue(Self.ua, forHTTPHeaderField: "User-Agent")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("https://soundcloud.com", forHTTPHeaderField: "Origin")
        req.setValue("https://soundcloud.com/", forHTTPHeaderField: "Referer")
        if let t = prefs.scToken { req.setValue("OAuth \(t)", forHTTPHeaderField: "Authorization") }
        if method != "GET" {
            // запись (лайки) проверяет защита DataDome: cookie и User-Agent из окна входа
            if let c = await WebCookies.header(for: "https://soundcloud.com") { req.setValue(c, forHTTPHeaderField: "Cookie") }
            req.setValue(Self.loginUA, forHTTPHeaderField: "User-Agent")
        }
        let (code, data, _) = try await Net.send(req)
        if (code == 401 || code == 403) && retry && !loggedIn {
            _ = try await clientId(force: true)
            return try await request(method, path, query: query, retry: false)
        }
        if code == 403 && String(decoding: data, as: UTF8.self).contains("captcha-delivery.com") {
            throw ApiError("SoundCloud просит пройти проверку — открой soundcloud.com в окне входа", code: 403)
        }
        guard (200..<300).contains(code) else { throw ApiError("SoundCloud \(method): \(code)", code: code) }
        return data.isEmpty ? nil : parseJSON(data)
    }

    private func obj(_ path: String, _ query: [String: String] = [:]) async throws -> JSON { try await request("GET", path, query: query) as? JSON ?? [:] }

    private func remember(_ list: [JSON]) -> [Track] {
        lock.lock()
        for t in list { if let id = t.str("id") { rawTracks[id] = t } }
        lock.unlock()
        return list.compactMap(Self.mapTrack)
    }

    func account() async throws -> Account {
        let token = prefs.scToken
        if let a = account, a.0 == token { return a.1 }
        let me = try await obj("/me")
        let a = Account(name: me.str("username") ?? "SoundCloud", uid: me.str("id"))
        account = (token, a)
        return a
    }

    private func uid() async throws -> String {
        guard let u = try await account().uid else { throw ApiError("SoundCloud не вернул id пользователя") }
        return u
    }

    private func fullTracks(_ items: [JSON]) async throws -> [JSON] {
        var full: [String: JSON] = [:]
        for i in items where i["title"] != nil { if let id = i.str("id") { full[id] = i } }
        let missing = items.filter { $0["title"] == nil }.compactMap { $0.str("id") }
        for start in stride(from: 0, to: missing.count, by: 50) {
            let chunk = missing[start..<min(start + 50, missing.count)]
            for t in (try await request("GET", "/tracks", query: ["ids": chunk.joined(separator: ",")]) as? [Any] ?? []).compactMap({ $0 as? JSON }) {
                if let id = t.str("id") { full[id] = t }
            }
        }
        return items.compactMap { $0.str("id").flatMap { full[$0] } }
    }

    func likedTracks(limit: Int = 5000) async throws -> [Track] {
        var out: [JSON] = []
        var dates: [String: Double] = [:]
        var res = try await obj("/users/\(try await uid())/track_likes", ["limit": "200"])
        for _ in 0..<30 {
            for item in res.objs("collection") {
                if let t = item.obj("track") {
                    out.append(t)
                    if let id = t.str("id") { dates[id] = isoDate(item.str("created_at")) }
                }
            }
            guard out.count < limit, let next = res.str("next_href") else { break }
            res = try await obj(next)
        }
        return remember(Array(out.prefix(limit))).map { var t = $0; t.likedAt = dates[t.srcId] ?? 0; return t }
    }

    func playlists() async throws -> [Playlist] {
        try await obj("/users/\(try await uid())/playlists", ["limit": "50"]).objs("collection").map { p in
            Playlist(id: "sc:\(p.str("id") ?? "")", source: Source.sc, title: p.str("title") ?? "", count: p.int("track_count"),
                     cover: Self.bigArtwork(p.str("artwork_url") ?? p.objs("tracks").first?.str("artwork_url")))
        }
    }

    func playlistTracks(_ id: String) async throws -> [Track] {
        let p = try await obj("/playlists/\(id.replacingOccurrences(of: "sc:", with: ""))")
        return remember(try await fullTracks(p.objs("tracks")))
    }

    func search(_ q: String) async throws -> [Track] { remember(try await obj("/search/tracks", ["q": q, "limit": "30"]).objs("collection")) }

    func related(_ srcId: String) async throws -> [Track] { remember(try await obj("/tracks/\(srcId)/related", ["limit": "30"]).objs("collection")) }

    func like(_ srcId: String, _ on: Bool) async throws {
        _ = try await request(on ? "PUT" : "DELETE", "/users/\(try await uid())/track_likes/\(srcId)")
    }

    /// Пул для «Моей волны»: «похожие» на случайные лайки
    func wavePool(exclude: Set<String>, size: Int = 20) async -> [Track] {
        let liked = ((try? await likedTracks(limit: 200)) ?? []).filter(\.available)
        var pool: [String: Track] = [:]
        for seed in liked.shuffled().prefix(3) {
            for t in (try? await related(seed.srcId)) ?? [] where t.available && !exclude.contains(t.id) { pool[t.id] = pool[t.id] ?? t }
            if pool.count >= size { break }
        }
        return Array(pool.values.shuffled().prefix(size))
    }

    private func freshTrack(_ srcId: String) async throws -> JSON {
        guard let t = (try await request("GET", "/tracks", query: ["ids": srcId]) as? [Any])?.first as? JSON else { throw ApiError("SoundCloud не нашёл трек") }
        lock.lock(); rawTracks[srcId] = t; lock.unlock()
        return t
    }

    func forget(_ srcId: String) { lock.lock(); rawTracks[srcId] = nil; lock.unlock() }

    private func cachedTrack(_ srcId: String) -> JSON? { lock.lock(); defer { lock.unlock() }; return rawTracks[srcId] }

    /// Ссылка на HLS-плейлист. На iOS сначала AAC (mp4): его AVPlayer играет надёжнее всего, потом mp3
    func hlsURL(_ srcId: String) async throws -> URL {
        var last: Error = ApiError("SoundCloud не отдал ссылку")
        for round in 0..<3 {
            if round > 0 { forget(srcId); try? await Task.sleep(nanoseconds: UInt64(300_000_000 * round)) }
            if round == 2 { _ = try? await clientId(force: true) }
            let cached = cachedTrack(srcId)
            let t: JSON
            do { t = cached?.obj("media") != nil ? cached! : try await freshTrack(srcId) } catch { last = error; continue }
            let list = (t.obj("media")?.objs("transcodings") ?? []).filter { tr in
                let f = tr.obj("format")
                let mime = f?.str("mime_type") ?? ""
                return f?.str("protocol") == "hls" && !tr.bool("snipped") && (mime.contains("mpeg") || mime.contains("mp4") || mime.contains("aac"))
            }.sorted { a, _ in (a.obj("format")?.str("mime_type") ?? "").contains("mp4") }
            if list.isEmpty { throw ApiError(t.str("policy") == "SNIP" ? "Трек только для SoundCloud Go+" : "У трека нет доступного потока") }
            let q = t.str("track_authorization").map { ["track_authorization": $0] } ?? [:]
            for tr in list {
                guard let u = tr.str("url") else { continue }
                do {
                    if let s = (try await request("GET", u, query: q) as? JSON)?.str("url"), let url = URL(string: s) { return url }
                } catch { last = error }
            }
        }
        throw last
    }
}
