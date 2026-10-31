import Foundation

/// Тексты песен — как на ПК и Android: Яндекс Музыка → Nyao LyricLabs → LRCLIB. С таймингами лучше.
actor LyricsAPI {
    static let shared = LyricsAPI()
    private var cache: [String: Lyrics] = [:]
    private var missing = Set<String>()
    private static let nyaoAPI = "https://api.corrode5-15.withnyao.app"

    static func parseLRC(_ lrc: String) -> [LyricLine] {
        var out: [LyricLine] = []
        for raw in lrc.components(separatedBy: .newlines) {
            let stamps = raw.allMatches("\\[(\\d+):(\\d+(?:\\.\\d+)?)\\]")
            if stamps.isEmpty { continue }
            let text = raw.replacing("\\[[^\\]]*\\]", with: "").trimmingCharacters(in: .whitespaces)
            for m in stamps { out.append(LyricLine(time: Double(Int(m[1]) ?? 0) * 60 + (Double(m[2]) ?? 0), text: text)) }
        }
        return out.sorted { ($0.time ?? 0) < ($1.time ?? 0) }
    }

    private static func cleanTitle(_ t: String) -> String {
        t.replacing("\\s*[(\\[][^)\\]]*(official|video|audio|lyric|ost|mv|клип)[^)\\]]*[)\\]]", with: "")
            .replacing("\\s+-\\s+.*(ost|soundtrack).*$", with: "")
            .trimmingCharacters(in: .whitespaces)
    }

    private static func get(_ url: URL) async -> Any? {
        var r = URLRequest(url: url)
        r.setValue("NyaoMusic/1.0 (iOS)", forHTTPHeaderField: "User-Agent")
        guard let res = try? await Net.send(r), (200..<300).contains(res.0) else { return nil }
        return parseJSON(res.1)
    }

    private static func from(_ o: JSON?, _ source: String) -> Lyrics? {
        guard let o else { return nil }
        if let s = o.str("syncedLyrics") { let l = parseLRC(s); if !l.isEmpty { return Lyrics(synced: true, lines: l, source: source) } }
        if let p = o.str("plainLyrics") { return Lyrics(synced: false, lines: p.components(separatedBy: .newlines).map { LyricLine(time: nil, text: $0) }, source: source) }
        return nil
    }

    private static func query(_ t: Track, extra: [String: String] = [:]) -> [String: String] {
        var q = ["track_name": cleanTitle(t.title), "artist_name": t.artist.components(separatedBy: ",").first?.trimmingCharacters(in: .whitespaces) ?? t.artist]
        if t.duration > 0 { q["duration"] = String(t.duration) }
        q.merge(extra) { $1 }
        return q
    }

    private static func nyao(_ t: Track) async -> Lyrics? {
        var extra: [String: String] = [:]
        if t.source == Source.ya, t.srcId.allSatisfy(\.isNumber) { extra["ya_id"] = t.srcId }
        return from(await get(Net.url(nyaoAPI + "/api/get", query(t, extra: extra))) as? JSON, "Nyao LyricLabs")
    }

    private static func lrclib(_ t: Track) async -> Lyrics? {
        if let l = from(await get(Net.url("https://lrclib.net/api/get", query(t))) as? JSON, "LRCLIB") { return l }
        let q = "\(query(t)["artist_name"] ?? "") \(cleanTitle(t.title))"
        let list = (await get(Net.url("https://lrclib.net/api/search", ["q": q])) as? [Any] ?? []).compactMap { $0 as? JSON }
        return from(list.first { $0.str("syncedLyrics") != nil } ?? list.first, "LRCLIB")
    }

    private static func yandex(_ t: Track, ya: YandexAPI) async -> Lyrics? {
        guard t.source == Source.ya, ya.loggedIn else { return nil }
        let name = { (p: String?) in p.map { "Яндекс Музыка · \($0)" } ?? "Яндекс Музыка" }
        if let lrc = await ya.lyrics(t.srcId, format: "LRC") {
            let lines = parseLRC(lrc.0)
            if !lines.isEmpty { return Lyrics(synced: true, lines: lines, source: name(lrc.1)) }
        }
        if let txt = await ya.lyrics(t.srcId, format: "TEXT") {
            return Lyrics(synced: false, lines: txt.0.components(separatedBy: .newlines).map { LyricLine(time: nil, text: $0) }, source: name(txt.1))
        }
        return nil
    }

    /// Первый текст с таймингами; если таймингов нет нигде — первый найденный
    func find(_ t: Track, ya: YandexAPI) async -> Lyrics? {
        if let c = cache[t.id] { return c }
        if missing.contains(t.id) { return nil }
        async let own = Self.nyao(t)
        var fallback: Lyrics?
        for step in 0..<3 {
            let r: Lyrics?
            switch step {
            case 0: r = await Self.yandex(t, ya: ya)
            case 1: r = await own
            default: r = await Self.lrclib(t)
            }
            if let r, r.synced { cache[t.id] = r; return r }
            if fallback == nil { fallback = r }
        }
        if let fallback { cache[t.id] = fallback } else { missing.insert(t.id) }
        return fallback
    }
}
