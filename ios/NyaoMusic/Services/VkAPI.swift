import Foundation
import WebKit

/// Cookie из встроенного окна входа (WKWebView). Пароль к нам не попадает; всё остаётся на устройстве.
enum WebCookies {
    @MainActor static func all() async -> [HTTPCookie] {
        await withCheckedContinuation { c in
            WKWebsiteDataStore.default().httpCookieStore.getAllCookies { c.resume(returning: $0) }
        }
    }

    /// Заголовок Cookie для адреса
    static func header(for url: String) async -> String? {
        guard let host = URL(string: url)?.host else { return nil }
        let cookies = await all().filter { c in
            let d = c.domain.hasPrefix(".") ? String(c.domain.dropFirst()) : c.domain
            return host == d || host.hasSuffix("." + d)
        }
        if cookies.isEmpty { return nil }
        return cookies.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
    }

    @MainActor static func clear(domains: [String]) async {
        let store = WKWebsiteDataStore.default()
        let types = WKWebsiteDataStore.allWebsiteDataTypes()
        let records = await store.dataRecords(ofTypes: types)
        let mine = records.filter { r in domains.contains { r.displayName.contains($0) } }
        await store.removeData(ofTypes: types, for: mine)
    }
}

/// VK Музыка — перенос VkApi.kt: внутренние запросы vk.com (al_audio.php) от имени сессии из окна входа.
/// Звук — HLS (.m3u8) с AES-128, AVPlayer расшифровывает сам.
final class VkAPI {
    static let ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0"
    private static let b64 = Array("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN0PQRSTUVWXYZO123456789+/=")
    private static let iId = 0, iOwner = 1, iUrl = 2, iTitle = 3, iPerformer = 4, iDuration = 5, iHashes = 13, iCover = 14

    private let prefs = Prefs.shared
    private let lock = NSLock()
    private var rawItems: [String: [Any]] = [:]
    private var token: (String, Double)?

    var uid: Int? { prefs.vkUid }
    var loggedIn: Bool { uid != nil }
    var base: String { prefs.vkOrigin ?? "https://vk.com" }

    func reset() { lock.lock(); rawItems = [:]; token = nil; lock.unlock() }

    // MARK: снятие маски со ссылки (как yt-dlp)

    static func vkDecode(_ enc: String) -> [UInt16] {
        var out: [UInt16] = []
        var e: Int32 = 0
        var n: Int32 = 0
        for ch in enc {
            guard let r = b64.firstIndex(of: ch) else { continue }
            let cond = n % 4
            e = cond != 0 ? 64 &* e &+ Int32(r) : Int32(r)
            n += 1
            if cond != 0 { out.append(UInt16(255 & (e >> ((-2 &* n) & 6)))) }
        }
        return out
    }

    static func unmaskURL(_ mask: String, uid: Int) -> String {
        guard mask.contains("audio_api_unavailable"), let q = mask.range(of: "?extra=") else { return mask }
        let extra = mask[q.upperBound...].split(separator: "#", omittingEmptySubsequences: false).map(String.init)
        let parts = String(utf16CodeUnits: vkDecode(extra.count > 1 ? extra[1] : ""), count: vkDecode(extra.count > 1 ? extra[1] : "").count)
            .split(separator: "\u{0B}", omittingEmptySubsequences: false).map(String.init)
        let baseNum = parts.count > 1 ? parts[1] : "0"
        var chars = vkDecode(extra[0])
        let len = Int32(chars.count)
        if len == 0 { return mask }
        var indexes = [Int32](repeating: 0, count: Int(len))
        var index = Int32(truncatingIfNeeded: Int64(baseNum) ?? 0) ^ Int32(truncatingIfNeeded: uid)
        var n = len - 1
        while n >= 0 {
            index = ((((len &* (n &+ 1)) ^ (index &+ n)) % len) + len) % len
            indexes[Int(n)] = index
            n -= 1
        }
        for i in 1..<Int(len) {
            let c = chars[i]
            let j = Int(indexes[Int(len) - 1 - i])
            chars[i] = chars[j]
            chars[j] = c
        }
        return String(utf16CodeUnits: chars, count: chars.count)
    }

    // MARK: разбор ответов

    private static func unescape(_ s: String?) -> String {
        (s ?? "").replacingOccurrences(of: "&quot;", with: "\"").replacingOccurrences(of: "&#039;", with: "'").replacingOccurrences(of: "&#39;", with: "'")
            .replacingOccurrences(of: "&lt;", with: "<").replacingOccurrences(of: "&gt;", with: ">").replacingOccurrences(of: "&amp;", with: "&")
            .replacing("<[^>]+>", with: "")
    }

    private static func isNum(_ v: Any?) -> Bool {
        if v is NSNumber { return true }
        if let s = v as? String { return s.range(of: "^-?\\d+$", options: .regularExpression) != nil }
        return false
    }

    private static func s(_ a: [Any], _ i: Int) -> String {
        guard i < a.count else { return "" }
        if let s = a[i] as? String { return s }
        if let n = a[i] as? NSNumber { return n.stringValue }
        return ""
    }

    static func isAudioItem(_ v: Any?) -> Bool {
        guard let a = v as? [Any], a.count > iHashes else { return false }
        return isNum(a[iId]) && isNum(a[iOwner]) && a[iTitle] is String && a[iPerformer] is String
    }

    static func mapAudio(_ a: [Any]) -> Track {
        let owner = s(a, iOwner), id = s(a, iId)
        var covers = s(a, iCover).split(separator: ",").map(String.init).filter { $0.hasPrefix("http") }
        if covers.isEmpty, let any = a.compactMap({ $0 as? String }).first(where: { $0.range(of: "^https://[^\\s\"]+\\.(jpe?g|png|webp)", options: [.regularExpression, .caseInsensitive]) != nil }) {
            covers = any.split(separator: ",").map(String.init).filter { $0.hasPrefix("http") }
        }
        let title = unescape(s(a, iTitle)), artist = unescape(s(a, iPerformer))
        // без обложки — nil: интерфейс рисует шаблонный диск (пустая обложка VK оставляла на экране прошлый трек)
        return Track(id: "vk:\(owner)_\(id)", source: Source.vk, srcId: "\(owner)_\(id)",
                     title: title.isEmpty ? "Без названия" : title, artist: artist.isEmpty ? "VK" : artist,
                     duration: Int(s(a, iDuration)) ?? 0, cover: covers.last)
    }

    static func collect(_ node: Any?, _ out: inout [[Any]], depth: Int = 0) {
        guard depth <= 12, let node, !(node is NSNull) else { return }
        if isAudioItem(node) { out.append(node as! [Any]); return }
        if let a = node as? [Any] { for x in a { collect(x, &out, depth: depth + 1) }; return }
        if let o = node as? JSON { for (_, v) in o { collect(v, &out, depth: depth + 1) }; return }
        if let str = node as? String {
            let t = str.trimmingCharacters(in: .whitespaces)
            if str.count > 20, t.hasPrefix("{") || t.hasPrefix("["), let parsed = parseJSON(str) { collect(parsed, &out, depth: depth + 1); return }
            guard str.contains("data-audio=") else { return }
            for m in str.allMatches("data-audio=\"([^\"]+)\"") where m.count > 1 {
                if let p = parseJSON(unescape(m[1])) { collect(p, &out, depth: depth + 1) }
            }
        }
    }

    private static func findPlaylist(_ node: Any?, depth: Int = 0) -> JSON? {
        guard depth <= 8 else { return nil }
        if let o = node as? JSON {
            if o["list"] is [Any] { return o }
            for (_, v) in o { if let f = findPlaylist(v, depth: depth + 1) { return f } }
        } else if let a = node as? [Any] {
            for v in a { if let f = findPlaylist(v, depth: depth + 1) { return f } }
        }
        return nil
    }

    static func apiAudioToItem(_ o: JSON) -> [Any] {
        var a: [Any] = Array(repeating: "", count: iCover + 1)
        let th = o.obj("album")?.obj("thumb")
        a[iId] = o["id"] ?? ""
        a[iOwner] = o["owner_id"] ?? ""
        a[iUrl] = o.str("url") ?? ""
        a[iTitle] = o.str("title") ?? ""
        a[iPerformer] = o.str("artist") ?? ""
        a[iDuration] = o.int("duration")
        a[iCover] = th.flatMap { $0.str("photo_1200") ?? $0.str("photo_600") ?? $0.str("photo_300") ?? $0.str("photo_270") } ?? ""
        return a
    }

    /// Ответы vk.com часто в windows-1251
    static func decode(_ data: Data, contentType: String?) -> String {
        if let cs = contentType?.firstMatch("charset=([\\w-]+)")?.lowercased(), cs.replacingOccurrences(of: "-", with: "") != "utf8" {
            if cs.contains("1251"), let s = String(data: data, encoding: .windowsCP1251) { return s }
        }
        if let s = String(data: data, encoding: .utf8) { return s }
        return String(data: data, encoding: .windowsCP1251) ?? ""
    }

    // MARK: запросы

    private func send(_ req: URLRequest) async throws -> (Int, String) {
        var r = req
        r.setValue(Self.ua, forHTTPHeaderField: "User-Agent")
        if let c = await WebCookies.header(for: r.url?.absoluteString ?? base) { r.setValue(c, forHTTPHeaderField: "Cookie") }
        let (code, data, res) = try await Net.send(r)
        return (code, Self.decode(data, contentType: res?.value(forHTTPHeaderField: "Content-Type")))
    }

    private func post(_ act: String, _ params: [String: String]) async throws -> Any? {
        guard let me = uid else { throw ApiError("Нужен вход во VK") }
        var req = URLRequest(url: URL(string: "\(base)/al_audio.php?act=\(act)")!)
        req.httpMethod = "POST"
        var p = params
        p["al"] = "1"
        p["act"] = act
        req.httpBody = Net.form(p)
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.setValue("XMLHttpRequest", forHTTPHeaderField: "X-Requested-With")
        req.setValue(base, forHTTPHeaderField: "Origin")
        req.setValue("\(base)/audios\(me)", forHTTPHeaderField: "Referer")
        let (code, text) = try await send(req)
        var t = text
        if let r = t.range(of: "^\\s*<!--", options: .regularExpression) { t.removeSubrange(r) }
        guard let json = parseJSON(t) as? JSON else { throw ApiError("VK ответил не тем, что ждали (HTTP \(code))", code: code) }
        guard let payload = json["payload"] as? [Any] else { throw ApiError("VK изменил формат ответа") }
        let head = payload.first.map { "\($0)" }
        if head == "3" {
            prefs.vkUid = nil
            throw ApiError("Сессия VK закончилась — войди заново", code: 401)
        }
        if head == "8" { throw ApiError("VK: " + Self.unescape((payload.count > 1 ? (payload[1] as? [Any])?.first as? String : nil) ?? "ошибка")) }
        return payload.count > 1 ? payload[1] : nil
    }

    private func remember(_ list: [[Any]]) -> [Track] {
        var seen = Set<String>()
        var out: [Track] = []
        lock.lock()
        for a in list {
            let t = Self.mapAudio(a)
            guard seen.insert(t.id).inserted else { continue }
            rawItems[t.srcId] = a
            out.append(t)
        }
        lock.unlock()
        return out
    }

    private func item(_ srcId: String) -> [Any]? { lock.lock(); defer { lock.unlock() }; return rawItems[srcId] }

    func account() -> Account { Account(name: "VK id\(uid ?? 0)", uid: uid.map(String.init)) }

    func likedTracks(limit: Int = 5000) async throws -> [Track] {
        guard let me = uid else { throw ApiError("Нужен вход во VK") }
        return try await loadPlaylist(owner: String(me), id: "-1", hash: "", limit: limit)
    }

    private func loadPlaylist(owner: String, id: String, hash: String, limit: Int = 5000) async throws -> [Track] {
        var out: [[Any]] = []
        var offset = 0
        for _ in 0..<60 {
            if out.count >= limit { break }
            let data = try await post("load_section", ["owner_id": owner, "playlist_id": id, "offset": String(offset), "type": "playlist", "access_hash": hash, "is_loading_all": "1"])
            let pl = Self.findPlaylist(data)
            var items: [[Any]] = []
            Self.collect(pl?["list"] ?? data, &items)
            if items.isEmpty { break }
            out += items
            guard let pl, pl.bool("hasMore") else { break }
            let next = pl.int("nextOffset")
            offset = next > 0 ? next : offset + items.count
        }
        return remember(Array(out.prefix(limit)))
    }

    func playlists() async throws -> [Playlist] {
        guard let me = uid else { return [] }
        let r = try await api("audio.getPlaylists", ["owner_id": String(me), "count": "100"])
        return ((r as? JSON)?.objs("items") ?? []).map { p in
            let th = (p.arr("thumbs").first as? JSON) ?? p.obj("photo")
            return Playlist(id: "vk:\(p.str("owner_id") ?? "")_\(p.str("id") ?? "")_\(p.str("access_key") ?? "")", source: Source.vk,
                            title: Self.unescape(p.str("title")).isEmpty ? "Плейлист" : Self.unescape(p.str("title")), count: p.int("count"),
                            cover: th.flatMap { $0.str("photo_600") ?? $0.str("photo_300") ?? $0.str("photo_270") }, subtitle: "VK Музыка")
        }
    }

    func playlistTracks(_ id: String) async throws -> [Track] {
        guard let m = id.allMatches("^vk:(-?\\d+)_(-?\\d+)_?(\\w*)$").first, m.count > 3 else { throw ApiError("Странный плейлист VK") }
        return try await loadPlaylist(owner: m[1], id: m[2], hash: m[3])
    }

    private func section(_ name: String, extra: [String: String] = [:]) async throws -> [Track] {
        var p = ["owner_id": String(uid ?? 0), "section": name, "claim": "0", "is_layer": "0"]
        p.merge(extra) { $1 }
        var items: [[Any]] = []
        Self.collect(try await post("section", p), &items)
        return remember(items)
    }

    /// Токен api.vk.com, который vk.com выдаёт своей веб-версии. Только в памяти
    private func webToken() async throws -> String {
        if let t = token, t.1 > nowMs() { return t.0 }
        let host = base.contains("vk.ru") ? "https://login.vk.ru" : "https://login.vk.com"
        var req = URLRequest(url: URL(string: "\(host)/?act=web_token")!)
        req.httpMethod = "POST"
        req.httpBody = Net.form(["version": "1", "app_id": "6287487"])
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.setValue(base, forHTTPHeaderField: "Origin")
        req.setValue("\(base)/", forHTTPHeaderField: "Referer")
        let (code, text) = try await send(req)
        guard let d = (parseJSON(text) as? JSON)?.obj("data"), let t = d.str("access_token") else { throw ApiError("web_token: HTTP \(code)") }
        let exp = d.double("expires") ?? 0
        token = (t, exp > 1_000_000_000 ? exp * 1000 - 60_000 : nowMs() + 30 * 60_000)
        return t
    }

    private func api(_ method: String, _ params: [String: String]) async throws -> Any? {
        let t = try await webToken()
        let host = base.contains("vk.ru") ? "https://api.vk.ru" : "https://api.vk.com"
        var req = URLRequest(url: URL(string: "\(host)/method/\(method)?v=5.199&client_id=6287487")!)
        req.httpMethod = "POST"
        var p = params
        p["access_token"] = t
        req.httpBody = Net.form(p)
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.setValue(base, forHTTPHeaderField: "Origin")
        req.setValue("\(base)/", forHTTPHeaderField: "Referer")
        let (_, text) = try await send(req)
        let j = parseJSON(text) as? JSON ?? [:]
        if let e = j.obj("error") {
            if e.int("error_code") == 5 { token = nil }
            throw ApiError("\(method): \(e.int("error_code")) \(e.str("error_msg") ?? "")")
        }
        return j["response"]
    }

    private func apiTracks(_ resp: Any?) -> [Track] {
        let items: [Any] = (resp as? JSON).map { $0.arr("items").isEmpty ? $0.arr("audios") : $0.arr("items") } ?? (resp as? [Any] ?? [])
        return remember(items.compactMap { $0 as? JSON }.filter { $0["owner_id"] != nil && $0["id"] != nil }.map(Self.apiAudioToItem))
    }

    /// Пробует способы по очереди, пока какой-то не вернёт треки
    private func firstOf(_ tries: [() async throws -> [Track]]) async throws -> [Track] {
        var lastError: Error?
        for t in tries {
            do { let l = try await t(); if !l.isEmpty { return l } } catch { lastError = error; if !loggedIn { throw error } }
        }
        if let lastError, !loggedIn { throw lastError }
        return []
    }

    func search(_ q: String) async throws -> [Track] {
        try await firstOf([
            { try await self.section("search", extra: ["q": q]) },
            { self.apiTracks(try await self.api("audio.search", ["q": q, "count": "100", "auto_complete": "1", "sort": "2"])) },
        ])
    }

    func recommendations() async throws -> [Track] {
        try await firstOf([
            { try await self.section("recoms") },
            { self.apiTracks(try await self.api("audio.getRecommendations", ["count": "100", "shuffle": "1"])) },
            { try await self.section("explore") },
        ])
    }

    private func hashes(_ srcId: String) -> [String] {
        guard let a = item(srcId) else { return [] }
        return Self.s(a, Self.iHashes).split(separator: "/", omittingEmptySubsequences: false).map(String.init)
    }

    func like(_ t: Track, _ on: Bool) async throws {
        let parts = t.srcId.split(separator: "_").map(String.init)
        let h = hashes(t.srcId)
        if on {
            guard h.count > 0, !h[0].isEmpty else { throw ApiError("VK не дал ключ для лайка этого трека") }
            _ = try await post("add", ["group_id": "0", "audio_owner_id": parts[0], "audio_id": parts.count > 1 ? parts[1] : "", "hash": h[0], "from": "search"])
        } else {
            guard h.count > 3, !h[3].isEmpty else { throw ApiError("VK не дал ключ для удаления этого трека") }
            _ = try await post("delete_audio", ["oid": parts[0], "aid": parts.count > 1 ? parts[1] : "", "hash": h[3], "restore": "1"])
        }
    }

    /// Пул для «Моей волны»: рекомендации VK + свои треки
    func wavePool(exclude: Set<String>, size: Int = 20) async -> [Track] {
        var pool: [String: Track] = [:]
        for t in (try? await recommendations()) ?? [] where !exclude.contains(t.id) { pool[t.id] = t }
        let liked = ((try? await likedTracks(limit: 200)) ?? []).shuffled()
        for t in liked.filter({ !exclude.contains($0.id) }).prefix(pool.isEmpty ? size : (size + 2) / 3) where pool[t.id] == nil { pool[t.id] = t }
        if pool.isEmpty { for t in liked.prefix(3) { pool[t.id] = t } }
        return Array(pool.values.shuffled().prefix(size))
    }

    /// Ссылка на звук: reload_audio → снять маску
    func streamURL(_ srcId: String) async throws -> URL {
        guard let me = uid else { throw ApiError("Нужен вход во VK") }
        var url = item(srcId).map { Self.s($0, Self.iUrl) } ?? ""
        if url.isEmpty {
            let h = hashes(srcId)
            let full = h.count > 5 ? "\(srcId)_\(h[2])_\(h[5])" : srcId
            var found: [Any]?
            if let data = try? await post("reload_audio", ["ids": full]) {
                var all: [[Any]] = []
                Self.collect(data, &all)
                found = all.first { "\(Self.s($0, Self.iOwner))_\(Self.s($0, Self.iId))" == srcId } ?? all.first
            }
            if found.map({ Self.s($0, Self.iUrl).isEmpty }) ?? true {
                if let r = try? await api("audio.getById", ["audios": srcId]) {
                    let o = (r as? [Any])?.first as? JSON ?? ((r as? JSON)?.arr("items").first as? JSON)
                    if let o, o.str("url") != nil { found = Self.apiAudioToItem(o) }
                }
            }
            guard let f = found, !Self.s(f, Self.iUrl).isEmpty else {
                throw ApiError("VK не дал ссылку на трек (возможно, он недоступен в твоей стране или нужна подписка)")
            }
            lock.lock(); rawItems[srcId] = f; lock.unlock()
            url = Self.s(f, Self.iUrl)
        }
        guard let u = URL(string: Self.unmaskURL(url, uid: me)) else { throw ApiError("Странная ссылка VK") }
        return u
    }

    /// Ссылка протухла — в следующий раз попросим новую
    func forget(_ srcId: String) {
        lock.lock()
        if var a = rawItems[srcId], a.count > Self.iUrl { a[Self.iUrl] = ""; rawItems[srcId] = a }
        lock.unlock()
    }
}
