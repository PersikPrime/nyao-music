import Foundation
import CryptoKit

/// Яндекс Музыка через неофициальное API — перенос YandexApi.kt (Android) и providers/yandex.js (ПК).
/// Если Яндекс что-то поменяет, править во всех трёх местах.
final class YandexAPI {
    static let api = "https://api.music.yandex.net"
    static let clientId = "23cabbbdc6cd418abb4b39c32c41195d"
    static let oauthURL = "https://oauth.yandex.ru/authorize?response_type=token&client_id=\(clientId)"
    private static let signSalt = "XGRlBW9FXlekgbPrRHuSiA"

    private let prefs = Prefs.shared
    private var account: Account?
    private var waveSession: String?
    private var waveBatch: String?
    private var radioSession: String?
    private var radioBatch: String?

    var loggedIn: Bool { !(prefs.yandexToken ?? "").isEmpty }

    func reset() { account = nil; waveSession = nil; waveBatch = nil }

    static func cover(_ uri: String?, _ size: Int = 400) -> String? {
        guard let uri, !uri.isEmpty else { return nil }
        return "https://" + uri.replacingOccurrences(of: "%%", with: "\(size)x\(size)")
    }

    static func mapTrack(_ t: JSON?) -> Track? {
        guard let t, let id = t.str("id") else { return nil }
        let album = t.objs("albums").first
        let artists = t.objs("artists").compactMap { $0.str("name") }
        let version = t.str("version")
        return Track(
            id: "ya:\(id)", source: Source.ya, srcId: id,
            title: (t.str("title") ?? "") + (version.map { " (\($0))" } ?? ""),
            artist: artists.isEmpty ? "Неизвестный исполнитель" : artists.joined(separator: ", "),
            album: album?.str("title") ?? "", albumId: album?.str("id"),
            duration: t.int("durationMs") / 1000,
            cover: cover(t.str("coverUri") ?? album?.str("coverUri") ?? t.str("ogImage")),
            available: t.bool("available", true),
            artistId: t.objs("artists").first?.str("id"))
    }

    // MARK: запросы

    private func raw(_ method: String, _ path: String, json: JSON? = nil, form: [String: String]? = nil, query: [String: String] = [:]) async throws -> Data {
        var req = URLRequest(url: Net.url(path.hasPrefix("http") ? path : Self.api + path, query))
        req.httpMethod = method
        req.setValue("YandexMusicAndroid/24023621", forHTTPHeaderField: "X-Yandex-Music-Client")
        req.setValue("Yandex-Music-API", forHTTPHeaderField: "User-Agent")
        req.setValue("ru", forHTTPHeaderField: "Accept-Language")
        if let t = prefs.yandexToken { req.setValue("OAuth \(t)", forHTTPHeaderField: "Authorization") }
        if let json {
            req.httpBody = try JSONSerialization.data(withJSONObject: json)
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        } else if let form {
            req.httpBody = Net.form(form)
            req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        }
        let (code, data, _) = try await Net.send(req)
        guard (200..<300).contains(code) else {
            throw ApiError("Яндекс \(method) \(path): \(code)", code: code)
        }
        return data
    }

    private func request(_ method: String, _ path: String, json: JSON? = nil, form: [String: String]? = nil, query: [String: String] = [:]) async throws -> Any? {
        let data = try await raw(method, path, json: json, form: form, query: query)
        let v = parseJSON(data)
        if let o = v as? JSON, o["result"] != nil { return o["result"] }
        return v
    }

    private func obj(_ m: String, _ p: String, json: JSON? = nil, form: [String: String]? = nil, query: [String: String] = [:]) async throws -> JSON {
        try await request(m, p, json: json, form: form, query: query) as? JSON ?? [:]
    }

    private func arr(_ m: String, _ p: String, json: JSON? = nil, form: [String: String]? = nil, query: [String: String] = [:]) async throws -> [JSON] {
        (try await request(m, p, json: json, form: form, query: query) as? [Any] ?? []).compactMap { $0 as? JSON }
    }

    // MARK: аккаунт

    func account() async throws -> Account {
        if let account { return account }
        let st = try await obj("GET", "/account/status")
        let acc = st.obj("account") ?? [:]
        let a = Account(name: acc.str("displayName") ?? acc.str("fullName") ?? acc.str("login") ?? "Яндекс",
                        plus: st.obj("plus")?.bool("hasPlus"), uid: acc.str("uid"))
        account = a
        return a
    }

    private func uid() async throws -> String {
        guard let u = try await account().uid else { throw ApiError("Яндекс не вернул id пользователя") }
        return u
    }

    // MARK: Моя волна

    private func sequence(_ o: JSON) -> [Track] { o.objs("sequence").compactMap { Self.mapTrack($0.obj("track")) } }

    func waveStart(diversity: String?, mood: String?) async throws -> [Track] {
        var seeds: [String] = ["user:onyourwave"]
        if let d = diversity, ["favorite", "discover", "popular"].contains(d) { seeds.append("settingDiversity:\(d)") }
        if let m = mood, ["active", "fun", "calm", "sad"].contains(m) { seeds.append("settingMoodEnergy:\(m)") }
        func body(_ s: [String]) -> JSON { ["seeds": s, "includeTracksInResponse": true, "includeWaveModel": false, "interactive": true] }
        let session: JSON
        do { session = try await obj("POST", "/rotor/session/new", json: body(seeds)) } catch {
            guard seeds.count > 1 else {
                waveSession = nil
                return sequence(try await obj("GET", "/rotor/station/user:onyourwave/tracks", query: ["settings2": "true"]))
            }
            session = try await obj("POST", "/rotor/session/new", json: body(["user:onyourwave"]))
        }
        waveSession = session.str("radioSessionId")
        waveBatch = session.str("batchId")
        return sequence(session)
    }

    func waveMore(queueIds: [String], diversity: String?, mood: String?) async throws -> [Track] {
        guard let sid = waveSession else { return try await waveStart(diversity: diversity, mood: mood) }
        let ids = queueIds.filter { $0.hasPrefix("ya:") }.suffix(10).map { String($0.dropFirst(3)) }
        do {
            let r = try await obj("POST", "/rotor/session/\(sid)/tracks", json: ["queue": ids])
            if let b = r.str("batchId") { waveBatch = b }
            return sequence(r)
        } catch {
            waveSession = nil
            return try await waveStart(diversity: diversity, mood: mood)
        }
    }

    func radioStart(trackId: String) async throws -> [Track] {
        let id = trackId.split(separator: ":").first.map(String.init) ?? trackId
        let s = try await obj("POST", "/rotor/session/new", json: ["seeds": ["track:\(id)"], "includeTracksInResponse": true, "includeWaveModel": false, "interactive": true])
        radioSession = s.str("radioSessionId")
        radioBatch = s.str("batchId")
        return sequence(s)
    }

    func radioMore(queueIds: [String]) async throws -> [Track] {
        guard let sid = radioSession else { return [] }
        let ids = queueIds.filter { $0.hasPrefix("ya:") }.suffix(10).map { String($0.dropFirst(3)) }
        let r = try await obj("POST", "/rotor/session/\(sid)/tracks", json: ["queue": ids])
        if let b = r.str("batchId") { radioBatch = b }
        return sequence(r)
    }

    /// type: radioStarted | trackStarted | trackFinished | skip | like | dislike
    func waveFeedback(_ type: String, track: Track?, played: Int = 0) async {
        guard let sid = waveSession else { return }
        if type != "radioStarted" && track?.source != Source.ya { return }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var event: JSON = ["type": type, "timestamp": f.string(from: Date()), "from": "mobile-radio-user-onyourwave"]
        if type != "radioStarted", let t = track { event["trackId"] = t.albumId.map { "\(t.srcId):\($0)" } ?? t.srcId }
        if ["trackFinished", "skip", "dislike"].contains(type) { event["totalPlayedSeconds"] = played }
        _ = try? await raw("POST", "/rotor/session/\(sid)/feedback", json: ["event": event, "batchId": waveBatch ?? ""])
    }

    // MARK: медиатека

    private func tracksByIds(_ ids: [String]) async throws -> [Track] {
        var out: [Track] = []
        for chunk in stride(from: 0, to: ids.count, by: 200).map({ Array(ids[$0..<min($0 + 200, ids.count)]) }) {
            let r = try await arr("POST", "/tracks", form: ["track-ids": chunk.joined(separator: ","), "with-positions": "false"])
            out += r.compactMap { Self.mapTrack($0) }
        }
        return out
    }

    func likedTracks(limit: Int = 10000) async throws -> [Track] {
        let r = try await obj("GET", "/users/\(try await uid())/likes/tracks")
        var entries = (r.obj("library")?.objs("tracks") ?? []).map { ($0, isoDate($0.str("timestamp"))) }
        if !entries.isEmpty && entries.allSatisfy({ $0.1 > 0 }) { entries.sort { $0.1 > $1.1 } }
        let picked = Array(entries.prefix(limit))
        let byId = Dictionary(try await tracksByIds(picked.map { e in (e.0.str("id") ?? "") + (e.0.str("albumId").map { ":\($0)" } ?? "") }).map { ($0.srcId, $0) },
                              uniquingKeysWith: { a, _ in a })
        return picked.compactMap { e in byId[e.0.str("id") ?? ""].map { var t = $0; t.likedAt = e.1; return t } }
    }

    private func mapPlaylist(_ p: JSON) -> Playlist {
        let c = p.obj("cover")
        let uri = c?.str("uri") ?? (c?.arr("itemsUri").first as? String) ?? p.str("ogImage")
        let owner = p.obj("owner")?.str("uid") ?? p.str("uid") ?? ""
        return Playlist(id: "ya:\(owner):\(p.str("kind") ?? "")", source: Source.ya, title: p.str("title") ?? "", count: p.int("trackCount"), cover: Self.cover(uri, 300))
    }

    func playlists() async throws -> [Playlist] {
        let own = try await arr("GET", "/users/\(try await uid())/playlists/list").map(mapPlaylist)
        let personal = (try? await obj("GET", "/landing3", query: ["blocks": "personalplaylists"]))?
            .objs("blocks").flatMap { $0.objs("entities") }.compactMap { $0.path("data", "data") }.map(mapPlaylist) ?? []
        return personal + own
    }

    func playlistTracks(_ id: String) async throws -> [Track] {
        let parts = id.split(separator: ":").map(String.init)
        guard parts.count >= 3 else { return [] }
        let r = try await obj("GET", "/users/\(parts[1])/playlists/\(parts[2])", query: ["rich-tracks": "true"])
        let items = r.objs("tracks")
        let with = items.compactMap { Self.mapTrack($0.obj("track")) }
        if !with.isEmpty { return with }
        return try await tracksByIds(items.map { i in (i.str("id") ?? "") + (i.str("albumId").map { ":\($0)" } ?? "") })
    }

    func albumTracks(_ id: String) async throws -> [Track] {
        let r = try await obj("GET", "/albums/\(id.replacingOccurrences(of: "yaalbum:", with: ""))/with-tracks")
        return r.arr("volumes").flatMap { ($0 as? [Any] ?? []).compactMap { Self.mapTrack($0 as? JSON) } }
    }

    func search(_ text: String) async throws -> [Track] {
        let r = try await obj("GET", "/search", query: ["text": text, "type": "track", "page": "0", "nocorrect": "false"])
        return (r.obj("tracks")?.objs("results") ?? []).compactMap { Self.mapTrack($0) }
    }

    func like(_ t: Track, _ on: Bool) async throws {
        _ = try await raw("POST", "/users/\(try await uid())/likes/tracks/\(on ? "add-multiple" : "remove")", form: ["track-ids": t.srcId])
    }

    // MARK: тексты

    /// Лицензированный текст Яндекса. format: LRC (по строкам со временем) или TEXT. → (текст, поставщик)
    func lyrics(_ trackId: String, format: String = "LRC") async -> (String, String?)? {
        let id = trackId.split(separator: ":").first.map(String.init) ?? trackId
        let ts = String(Int(Date().timeIntervalSince1970))
        let key = SymmetricKey(data: Data("p93jhgh689SBReK6ghtw62".utf8))
        let sign = Data(HMAC<SHA256>.authenticationCode(for: Data("\(id)\(ts)".utf8), using: key)).base64EncodedString()
        guard let r = try? await obj("GET", "/tracks/\(id)/lyrics", query: ["format": format, "timeStamp": ts, "sign": sign]),
              let url = r.str("downloadUrl"), let u = URL(string: url),
              let res = try? await Net.text(URLRequest(url: u)), (200..<300).contains(res.0), !res.1.isEmpty else { return nil }
        let text = res.1
        let major = r.obj("major").flatMap { $0.str("prettyName") ?? $0.str("name") }
        return (text, major)
    }

    // MARK: поток

    /// Прямая ссылка на mp3. Живёт около часа.
    func streamURL(_ srcId: String) async throws -> URL {
        let infos = try await arr("GET", "/tracks/\(srcId)/download-info")
        guard let best = infos.filter({ $0.str("codec") == "mp3" }).max(by: { $0.int("bitrateInKbps") < $1.int("bitrateInKbps") }) ?? infos.first,
              let infoURL = best.str("downloadInfoUrl") else {
            throw ApiError("Яндекс не отдал ссылку на трек (нет подписки или трек недоступен)")
        }
        let xml = String(decoding: try await raw("GET", infoURL), as: UTF8.self)
        func tag(_ n: String) -> String? { xml.firstMatch("<\(n)>([^<]*)</\(n)>") }
        guard let host = tag("host"), let path = tag("path"), let ts = tag("ts"), let s = tag("s") else {
            throw ApiError("Не удалось разобрать download-info Яндекса")
        }
        let sign = md5(Self.signSalt + String(path.dropFirst()) + s)
        guard let u = URL(string: "https://\(host)/get-mp3/\(sign)/\(ts)\(path)") else { throw ApiError("Странная ссылка Яндекса") }
        return u
    }
}
