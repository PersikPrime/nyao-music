import Foundation

/// Трек любого сервиса. id = "ya:123", "vk:1_2", "sc:123" — как на ПК и Android.
struct Track: Identifiable, Hashable, Codable {
    var id: String
    var source: String
    var srcId: String
    var title: String
    var artist: String
    var album: String = ""
    var albumId: String? = nil
    var duration: Int = 0
    /// nil — рисуем шаблонную обложку (диск на цвете)
    var cover: String? = nil
    var available: Bool = true
    var artistId: String? = nil
    var likedAt: Double = 0

    static func == (a: Track, b: Track) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }
}

struct Playlist: Identifiable, Hashable {
    var id: String
    var source: String
    var title: String
    var count: Int = 0
    var cover: String? = nil
    var subtitle: String = ""
}

struct Account: Hashable, Codable {
    var name: String
    var plus: Bool? = nil
    var uid: String? = nil
}

enum Source {
    static let ya = "ya"
    static let vk = "vk"
    static let sc = "sc"
    static let yt = "yt"
    static let sp = "sp"
    static let all = [ya, vk, sc]

    static func name(_ s: String, genitive: Bool = false) -> String {
        switch s {
        case ya: return genitive ? "Яндекс Музыки" : "Яндекс Музыка"
        case vk: return genitive ? "VK Музыки" : "VK Музыка"
        case sc: return "SoundCloud"
        case sp: return "Spotify"
        default: return "YouTube Music"
        }
    }
}

func formatTime(_ sec: Double) -> String {
    guard sec.isFinite, sec > 0 else { return "0:00" }
    let s = Int(sec)
    let h = s / 3600, m = (s % 3600) / 60, r = s % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, r) : String(format: "%d:%02d", m, r)
}

/// Чередует списки: a0, b0, c0, a1, b1, …
func alternateAll<T>(_ lists: [[T]]) -> [T] {
    var out: [T] = []
    let n = lists.map(\.count).max() ?? 0
    for i in 0..<n { for l in lists where i < l.count { out.append(l[i]) } }
    return out
}

/// Склонение: plural(3, "трек", "трека", "треков")
func plural(_ n: Int, _ one: String, _ few: String, _ many: String) -> String {
    let a = n % 10, b = n % 100
    if a == 1 && b != 11 { return one }
    if (2...4).contains(a) && !(12...14).contains(b) { return few }
    return many
}

// MARK: - Мини-соцсеть Nyao

struct CloudUser: Hashable {
    var name: String
    var username: String?
    var picture: String?
}

struct UserCard: Identifiable, Hashable {
    var id: String
    var nick: String
    var name: String
    var picture: String?
    var shape: String?
    var color: String?
    var display: String { name.isEmpty ? "@\(nick)" : name }
}

struct FriendNow: Hashable {
    var track: Track
    var playing: Bool
    var updatedAt: Double
}

struct Friend: Identifiable, Hashable {
    var user: UserCard
    var now: FriendNow?
    var online: Bool
    var id: String { user.id }
}

struct ProfileLink: Hashable { var kind: String; var url: String }
struct Badge: Hashable, Identifiable { var id: String; var title: String; var mark: String; var tone: String }
struct TopArtist: Hashable { var name: String; var plays: Int }

struct PublicProfile {
    var user: UserCard
    var relation: String
    var isPrivate: Bool
    var bio: String
    var friends: Int
    var now: FriendNow?
    var badges: [Badge]
    var banner: String?
    var links: [ProfileLink]
    var statusTrack: Track?
    var minutes: Int
    var plays: Int
    var topArtists: [TopArtist]
}

struct MyProfile {
    var nick: String
    var bio: String
    var color: String?
    var avatarShape: String
    var banner: String?
}

struct InboxItem: Identifiable, Hashable {
    var id: String
    var kind: String
    var from: UserCard?
    var emoji: String?
    var track: Track?
    var read: Bool
    var at: Double
}

// MARK: - Тексты

struct LyricLine: Hashable {
    var time: Double?
    var text: String
}

struct Lyrics {
    var synced: Bool
    var lines: [LyricLine]
    var source: String
}
