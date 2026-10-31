import Foundation
import CryptoKit

struct ApiError: LocalizedError {
    var message: String
    var code: Int = 0
    init(_ message: String, code: Int = 0) { self.message = message; self.code = code }
    var errorDescription: String? { message }
}

/// Сеть: URLSession без своих cookie (их подставляем вручную, где надо — VK, SoundCloud)
enum Net {
    static let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 20
        c.timeoutIntervalForResource = 60
        c.httpShouldSetCookies = false
        c.httpCookieAcceptPolicy = .never
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: c)
    }()

    static let longSession: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 45
        c.httpShouldSetCookies = false
        return URLSession(configuration: c)
    }()

    /// → (код, тело, заголовки)
    static func send(_ req: URLRequest, long: Bool = false) async throws -> (Int, Data, HTTPURLResponse?) {
        let (data, res) = try await (long ? longSession : session).data(for: req)
        let http = res as? HTTPURLResponse
        return (http?.statusCode ?? 0, data, http)
    }

    static func text(_ req: URLRequest) async throws -> (Int, String) {
        let (code, data, _) = try await send(req)
        return (code, String(decoding: data, as: UTF8.self))
    }

    static func url(_ base: String, _ query: [String: String] = [:]) -> URL {
        var c = URLComponents(string: base)!
        if !query.isEmpty {
            var items = c.queryItems ?? []
            for (k, v) in query.sorted(by: { $0.key < $1.key }) {
                items.removeAll { $0.name == k }
                items.append(URLQueryItem(name: k, value: v))
            }
            c.queryItems = items
            // «+» в значениях URLComponents не кодирует, а серверы читают его как пробел
            c.percentEncodedQuery = c.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        }
        return c.url!
    }

    static func form(_ params: [String: String]) -> Data {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return params.map { k, v in
            "\(k.addingPercentEncoding(withAllowedCharacters: allowed) ?? k)=\(v.addingPercentEncoding(withAllowedCharacters: allowed) ?? v)"
        }.joined(separator: "&").data(using: .utf8)!
    }
}

func md5(_ s: String) -> String {
    Insecure.MD5.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
}

func sha1Bytes(_ s: String) -> [UInt8] { Array(Insecure.SHA1.hash(data: Data(s.utf8))) }

// MARK: - JSON без моделей: ответы неофициальных API меняются, разбираем терпимо

typealias JSON = [String: Any]

func parseJSON(_ data: Data) -> Any? { try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) }
func parseJSON(_ s: String) -> Any? { parseJSON(Data(s.utf8)) }

extension Dictionary where Key == String, Value == Any {
    func obj(_ k: String) -> JSON? { self[k] as? JSON }
    func arr(_ k: String) -> [Any] { self[k] as? [Any] ?? [] }
    func objs(_ k: String) -> [JSON] { arr(k).compactMap { $0 as? JSON } }
    func str(_ k: String) -> String? {
        switch self[k] {
        case let s as String: return s.isEmpty ? nil : s
        case let n as NSNumber: return n.stringValue
        default: return nil
        }
    }
    func int(_ k: String) -> Int {
        switch self[k] {
        case let n as NSNumber: return n.intValue
        case let s as String: return Int(s) ?? 0
        default: return 0
        }
    }
    func double(_ k: String) -> Double? {
        switch self[k] {
        case let n as NSNumber: return n.doubleValue
        case let s as String: return Double(s)
        default: return nil
        }
    }
    func bool(_ k: String, _ def: Bool = false) -> Bool {
        switch self[k] {
        case let b as Bool: return b
        case let n as NSNumber: return n.boolValue
        default: return def
        }
    }
    func path(_ keys: String...) -> JSON? {
        var cur: JSON? = self
        for k in keys { cur = cur?.obj(k) }
        return cur
    }
}

func isoDate(_ s: String?) -> Double {
    guard let s else { return 0 }
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = f.date(from: s) { return d.timeIntervalSince1970 * 1000 }
    f.formatOptions = [.withInternetDateTime]
    return (f.date(from: s)?.timeIntervalSince1970 ?? 0) * 1000
}

func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

extension String {
    func firstMatch(_ pattern: String, group: Int = 1) -> String? {
        guard let re = try? NSRegularExpression(pattern: pattern, options: []) else { return nil }
        let ns = self as NSString
        guard let m = re.firstMatch(in: self, range: NSRange(location: 0, length: ns.length)), m.numberOfRanges > group,
              m.range(at: group).location != NSNotFound else { return nil }
        return ns.substring(with: m.range(at: group))
    }

    func allMatches(_ pattern: String) -> [[String]] {
        guard let re = try? NSRegularExpression(pattern: pattern, options: []) else { return [] }
        let ns = self as NSString
        return re.matches(in: self, range: NSRange(location: 0, length: ns.length)).map { m in
            (0..<m.numberOfRanges).map { m.range(at: $0).location == NSNotFound ? "" : ns.substring(with: m.range(at: $0)) }
        }
    }

    func replacing(_ pattern: String, with tpl: String) -> String {
        guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return self }
        return re.stringByReplacingMatches(in: self, range: NSRange(location: 0, length: (self as NSString).length), withTemplate: tpl)
    }
}
