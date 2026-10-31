import SwiftUI
import UIKit

extension Color {
    init(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        let v = UInt64(s, radix: 16) ?? 0xC6B8FF
        self.init(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}

enum Nyao {
    static let accent = Color(hex: "#C6B8FF")
    static let ink = Color(hex: "#120D26")
    static let bg = Color.black
    static let surface = Color(hex: "#0E0D14")
    static let surface2 = Color(hex: "#14131A")
    static let line = Color(hex: "#1E1B2B")
    static let muted = Color(hex: "#9A9AA2")
    static let text = Color(hex: "#F2F2F3")

    static func title(_ size: CGFloat) -> Font { .system(size: size, weight: .bold, design: .rounded) }
}

/// Шаблонная обложка «диск на цвете» — как на ПК и Android (тот же цвет для того же трека)
enum TemplateCover {
    static let palette: [(String, String)] = [
        ("#17142A", "#C6B8FF"), ("#1E0E0E", "#FF6A5C"), ("#1E1A08", "#FFD60A"), ("#1A0C0C", "#FF8A7A"),
        ("#0E1A16", "#7CE0C3"), ("#101420", "#8FB4FF"), ("#1E1408", "#FFB86B"), ("#1E0E16", "#FF8FB1"),
    ]

    static func colors(for key: String) -> (Color, Color) {
        let p = palette[Int(sha1Bytes(key)[0]) % palette.count]
        return (Color(hex: p.0), Color(hex: p.1))
    }

    static func image(for key: String, size: CGFloat) -> UIImage {
        let p = palette[Int(sha1Bytes(key)[0]) % palette.count]
        return UIGraphicsImageRenderer(size: CGSize(width: size, height: size)).image { ctx in
            UIColor(Color(hex: p.0)).setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))
            let k = size * 0.6 / 72
            UIColor(Color(hex: p.1)).setStroke()
            for r in [26.0, 12.0] {
                let rr = r * k
                let path = UIBezierPath(ovalIn: CGRect(x: size / 2 - rr, y: size / 2 - rr, width: rr * 2, height: rr * 2))
                path.lineWidth = 3 * k
                path.stroke()
            }
        }
    }
}

struct TemplateCoverView: View {
    let key: String
    var body: some View {
        let (bg, fg) = TemplateCover.colors(for: key)
        GeometryReader { g in
            let s = min(g.size.width, g.size.height)
            ZStack {
                bg
                Circle().stroke(fg, lineWidth: s * 0.6 / 72 * 3).frame(width: s * 0.6 * 52 / 72, height: s * 0.6 * 52 / 72)
                Circle().stroke(fg, lineWidth: s * 0.6 / 72 * 3).frame(width: s * 0.6 * 24 / 72, height: s * 0.6 * 24 / 72)
            }
            .frame(width: g.size.width, height: g.size.height)
        }
    }
}

/// Обложка трека: картинка сервиса или шаблонный диск
struct CoverView: View {
    let url: String?
    let key: String
    var radius: CGFloat = 12

    var body: some View {
        Group {
            if let url, let u = URL(string: url) {
                AsyncImage(url: u, transaction: Transaction(animation: .easeOut(duration: 0.2))) { phase in
                    switch phase {
                    case .success(let img): img.resizable().scaledToFill()
                    case .failure: TemplateCoverView(key: key)
                    default: Rectangle().fill(Nyao.surface2)
                    }
                }
            } else {
                TemplateCoverView(key: key)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
    }
}

struct SourceBadge: View {
    let source: String
    var body: some View {
        let (bg, fg, t): (String, String, String) = {
            switch source {
            case Source.ya: return ("#FFD60A", "#000000", "Я")
            case Source.vk: return ("#2787F5", "#FFFFFF", "VK")
            case Source.sc: return ("#FF5500", "#FFFFFF", "SC")
            case Source.sp: return ("#1ED760", "#000000", "SP")
            default: return ("#FF0033", "#FFFFFF", "YT")
            }
        }()
        Text(t).font(.system(size: 9, weight: .heavy)).foregroundStyle(Color(hex: fg))
            .padding(.horizontal, 4).padding(.vertical, 1)
            .background(Color(hex: bg), in: RoundedRectangle(cornerRadius: 3))
    }
}

/// Контур «печеньки» в квадрате: n лепестков, глубина amp — как на ПК и Android
struct CookieShape: Shape {
    var lobes = 9
    var amp = 0.07
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let c = CGPoint(x: rect.midX, y: rect.midY)
        let R = min(rect.width, rect.height) / 2
        for i in 0..<120 {
            let t = 2 * Double.pi * Double(i) / 120
            let r = R * (1 - amp) + R * amp * cos(Double(lobes) * t)
            let pt = CGPoint(x: c.x + r * sin(t), y: c.y - r * cos(t))
            i == 0 ? p.move(to: pt) : p.addLine(to: pt)
        }
        p.closeSubpath()
        return p
    }
}

struct AvatarShape: Shape {
    let kind: String?
    func path(in rect: CGRect) -> Path {
        switch kind {
        case "circle": return Circle().path(in: rect)
        case "squircle": return RoundedRectangle(cornerRadius: rect.width * 0.26, style: .continuous).path(in: rect)
        default: return CookieShape().path(in: rect)
        }
    }
}

/// Аватар нужной формы: картинка Telegram или буква на цвете профиля
struct Avatar: View {
    let user: UserCard
    var size: CGFloat = 44

    var body: some View {
        let color = Color(hex: user.color ?? "#C6B8FF")
        ZStack {
            AvatarShape(kind: user.shape).fill(color)
            if let p = user.picture, let u = URL(string: p) {
                AsyncImage(url: u) { img in img.resizable().scaledToFill() } placeholder: { letter }
            } else {
                letter
            }
        }
        .frame(width: size, height: size)
        .clipShape(AvatarShape(kind: user.shape))
    }

    private var letter: some View {
        Text(String((user.display.trimmingCharacters(in: CharacterSet(charactersIn: "@ ")).first ?? "N")).uppercased())
            .font(.system(size: size * 0.4, weight: .heavy, design: .rounded)).foregroundStyle(Nyao.ink)
    }
}

/// Стеклянная подложка (iOS 26 — Liquid Glass, раньше — материал)
struct GlassBackground: ViewModifier {
    var radius: CGFloat
    func body(content: Content) -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            content.glassEffect(.regular, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
        } else {
            material(content)
        }
        #else
        material(content)
        #endif
    }

    private func material(_ content: Content) -> some View {
        content.background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).stroke(Color.white.opacity(0.12)))
    }
}

extension View {
    func glass(_ radius: CGFloat = 24) -> some View { modifier(GlassBackground(radius: radius)) }
}

/// Строка трека для списков
struct TrackRow: View {
    let track: Track
    var active = false
    @EnvironmentObject var repo: Repo

    var body: some View {
        HStack(spacing: 12) {
            CoverView(url: track.cover, key: track.id, radius: 10).frame(width: 48, height: 48)
            VStack(alignment: .leading, spacing: 3) {
                Text(track.title).font(.system(size: 15, weight: .semibold)).lineLimit(1)
                    .foregroundStyle(active ? Nyao.accent : (track.available ? Nyao.text : Nyao.muted))
                HStack(spacing: 6) {
                    SourceBadge(source: track.source)
                    Text(track.artist).font(.system(size: 13)).foregroundStyle(Nyao.muted).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if repo.likedIds.contains(track.id) {
                Image(systemName: "heart.fill").font(.system(size: 13)).foregroundStyle(Color(hex: "#FF8FB1"))
            }
            if track.duration > 0 {
                Text(formatTime(Double(track.duration))).font(.system(size: 12).monospacedDigit()).foregroundStyle(Nyao.muted)
            }
        }
        .contentShape(Rectangle())
    }
}
