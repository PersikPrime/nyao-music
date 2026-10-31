import Foundation
import Security

/// Токены и входы — только на этом устройстве, в Keychain. На сервер Nyao они не уходят.
enum Keychain {
    private static let service = "app.withnyao.music"

    static func get(_ key: String) -> String? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: key, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }

    static func set(_ key: String, _ value: String?) {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
        SecItemDelete(base as CFDictionary)
        guard let value, !value.isEmpty else { return }
        var add = base
        add[kSecValueData as String] = Data(value.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }
}

/// Настройки и входы
final class Prefs {
    static let shared = Prefs()
    private let d = UserDefaults.standard

    var yandexToken: String? { get { Keychain.get("yandexToken") } set { Keychain.set("yandexToken", newValue) } }
    var scToken: String? { get { Keychain.get("scToken") } set { Keychain.set("scToken", newValue) } }
    var nyaoToken: String? { get { Keychain.get("nyaoToken") } set { Keychain.set("nyaoToken", newValue) } }

    var vkUid: Int? {
        get { let v = d.integer(forKey: "vkUid"); return v > 0 ? v : nil }
        set { if let v = newValue { d.set(v, forKey: "vkUid") } else { d.removeObject(forKey: "vkUid") } }
    }
    var vkOrigin: String? { get { d.string(forKey: "vkOrigin") } set { d.set(newValue, forKey: "vkOrigin") } }

    var nyaoUser: Data? { get { d.data(forKey: "nyaoUser") } set { d.set(newValue, forKey: "nyaoUser") } }

    /// Доля сервисов в волне и настроение
    var waveSources: [String] {
        get { d.stringArray(forKey: "waveSources") ?? Source.all }
        set { d.set(newValue, forKey: "waveSources") }
    }
    var waveMood: String? { get { d.string(forKey: "waveMood") } set { d.set(newValue, forKey: "waveMood") } }
    var waveDiversity: String { get { d.string(forKey: "waveDiversity") ?? "default" } set { d.set(newValue, forKey: "waveDiversity") } }

    var onboarded: Bool { get { d.bool(forKey: "onboarded") } set { d.set(newValue, forKey: "onboarded") } }

    /// Устройство для сервера Nyao: стабильный id-имя
    var deviceName: String {
        if let s = d.string(forKey: "deviceName") { return s }
        let name = "iOS"
        d.set(name, forKey: "deviceName")
        return name
    }
}

/// История прослушиваний на устройстве (для «Продолжить», волны без повторов и отправки на сервер Nyao)
actor History {
    static let shared = History()
    private let max = 1500
    private var file: URL { FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("history.json") }
    private var outboxFile: URL { FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("cloud-outbox.json") }

    private func read(_ f: URL) -> [JSON] { (try? Data(contentsOf: f)).flatMap { parseJSON($0) as? [JSON] } ?? [] }
    private func write(_ f: URL, _ a: [JSON]) {
        try? FileManager.default.createDirectory(at: f.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let d = try? JSONSerialization.data(withJSONObject: a) { try? d.write(to: f, options: .atomic) }
    }

    func record(_ t: Track, listened: Int, skipped: Bool, cloud: Bool) {
        let play: JSON = ["trackId": t.id, "source": t.source, "title": t.title, "artist": t.artist, "cover": t.cover ?? NSNull(),
                          "duration": t.duration, "listened": listened, "skipped": skipped, "playedAt": Int64(nowMs())]
        var h = read(file)
        h.insert(play, at: 0)
        if h.count > max { h.removeLast(h.count - max) }
        write(file, h)
        if cloud { var o = read(outboxFile); o.append(play); write(outboxFile, o) }
    }

    func outbox() -> [JSON] { read(outboxFile) }
    func dropOutbox(_ n: Int) { var o = read(outboxFile); o.removeFirst(Swift.min(n, o.count)); write(outboxFile, o) }

    func recent(limit: Int = 12) -> [Track] {
        var seen = Set<String>(), out: [Track] = []
        for p in read(file) {
            guard !p.bool("skipped"), let id = p.str("trackId"), seen.insert(id).inserted, let t = History.track(p) else { continue }
            out.append(t)
            if out.count >= limit { break }
        }
        return out
    }

    func recentIds(days: Double = 14, skippedDays: Double = 30) -> Set<String> {
        let now = nowMs()
        var ids = Set<String>()
        for p in read(file) {
            let age = now - (p.double("playedAt") ?? 0)
            if age < days * 86_400_000 || (p.bool("skipped") && age < skippedDays * 86_400_000), let id = p.str("trackId") { ids.insert(id) }
        }
        return ids
    }

    static func track(_ p: JSON) -> Track? {
        guard let id = p.str("trackId"), let i = id.firstIndex(of: ":") else { return nil }
        return Track(id: id, source: p.str("source") ?? String(id[..<i]), srcId: String(id[id.index(after: i)...]),
                     title: p.str("title") ?? "", artist: p.str("artist") ?? "", duration: p.int("duration"), cover: p.str("cover"))
    }
}
