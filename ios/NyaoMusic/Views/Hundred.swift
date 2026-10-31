import SwiftUI

/// Пасхалка сотой сборки: волны, из которых складывается «100». Как на ПК и Android.
/// Один раз при первом запуске, по пяти нажатиям на версию и на сотом треке. Счётчик — только на устройстве.
@MainActor
final class Hundred: ObservableObject {
    static let shared = Hundred()
    struct Scene: Identifiable { let id = UUID(); let title: String; let text: String }

    @Published var scene: Scene?
    private let d = UserDefaults.standard
    private var taps = 0
    private var lastTap = Date.distantPast

    var plays: Int { d.integer(forKey: "hundred.plays") }

    static func countPlay() {
        let s = shared
        let n = s.plays + 1
        s.d.set(n, forKey: "hundred.plays")
        guard n % 100 == 0 else { return }
        if n == 100 { s.scene = Scene(title: "Сотый трек!", text: "Ровно сто треков в Nyao Music. Дальше — больше.") }
        else { Repo.shared.show("Это твой \(n)-й трек в Nyao Music 🎉") }
    }

    func maybeFirstRun() {
        guard !d.bool(forKey: "hundred.seen") else { return }
        d.set(true, forKey: "hundred.seen")
        scene = Scene(title: "Сотая сборка", text: "Nyao Music 0.8 (100) — теперь и на iPhone. Спасибо, что слушаешь с нами.")
    }

    func tapVersion() {
        if Date().timeIntervalSince(lastTap) > 1.5 { taps = 0 }
        lastTap = Date()
        taps += 1
        guard taps >= 5 else { return }
        taps = 0
        let n = plays
        scene = Scene(title: "Сотая сборка", text: n > 0 ? "С тобой уже \(n) \(plural(n, "трек", "трека", "треков")). Спасибо, что слушаешь." : "Спасибо, что слушаешь с нами.")
    }
}

private let waveColors = ["#C6B8FF", "#7CE0C3", "#FFB86B", "#FF8FB1", "#8FB4FF", "#FFD60A"].map { Color(hex: $0) }

/// Маска «100» на маленькой сетке, размытая — волны поднимаются плавно
private struct TextMask {
    static let W = 160, H = 80
    let w = TextMask.W, h = TextMask.H
    var a: [Float]

    init(text: String) {
        let w = TextMask.W, h = TextMask.H
        let size = CGSize(width: w, height: h)
        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = 1
        let img = UIGraphicsImageRenderer(size: size, format: fmt).image { _ in
            var fs: CGFloat = CGFloat(h) * 0.82
            var attrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: fs, weight: .black), .foregroundColor: UIColor.white]
            while (text as NSString).size(withAttributes: attrs).width > CGFloat(w) * 0.9 && fs > 8 {
                fs -= 2
                attrs[.font] = UIFont.systemFont(ofSize: fs, weight: .black)
            }
            let s = (text as NSString).size(withAttributes: attrs)
            (text as NSString).draw(at: CGPoint(x: (CGFloat(w) - s.width) / 2, y: (CGFloat(h) - s.height) / 2), withAttributes: attrs)
        }
        var src = [Float](repeating: 0, count: w * h)
        if let cg = img.cgImage, let data = cg.dataProvider?.data, let ptr = CFDataGetBytePtr(data) {
            let bpr = cg.bytesPerRow, bpp = cg.bitsPerPixel / 8
            for y in 0..<min(h, cg.height) { for x in 0..<min(w, cg.width) { src[y * w + x] = Float(ptr[y * bpr + x * bpp]) / 255 } }
        }
        // коробочное размытие, два прохода
        let r = 2
        var tmp = src
        for _ in 0..<2 {
            for y in 0..<h { for x in 0..<w {
                var s: Float = 0, n: Float = 0
                for k in -r...r where (0..<w).contains(x + k) { s += src[y * w + x + k]; n += 1 }
                tmp[y * w + x] = s / n
            } }
            for y in 0..<h { for x in 0..<w {
                var s: Float = 0, n: Float = 0
                for k in -r...r where (0..<h).contains(y + k) { s += tmp[(y + k) * w + x]; n += 1 }
                src[y * w + x] = s / n
            } }
        }
        a = src
    }

    func at(_ u: Double, _ v: Double) -> Double {
        let x = max(0, min(w - 1, Int(u * Double(w - 1))))
        let y = max(0, min(h - 1, Int(v * Double(h - 1))))
        return Double(a[y * w + x])
    }
}

struct HundredView: View {
    let scene: Hundred.Scene
    let close: () -> Void
    @State private var start = Date()
    private let mask = TextMask(text: "100")

    var body: some View {
        ZStack(alignment: .bottom) {
            RadialGradient(colors: [Color(hex: "#17142A"), Color(hex: "#050507")], center: .init(x: 0.5, y: 0.3), startRadius: 0, endRadius: 700)
                .ignoresSafeArea()
            TimelineView(.animation) { tl in
                Canvas { ctx, size in
                    let t = tl.date.timeIntervalSince(start)
                    let k = min(1, t / 2.4)
                    let e = 1 - pow(1 - k, 3)
                    let top = size.height * 0.08
                    let span = size.height * 0.55
                    let lines = max(22, Int(span / 13))
                    let step = span / Double(lines)
                    for i in 0..<lines {
                        let y0 = top + Double(i) * step
                        var p = Path()
                        var x = 0.0
                        while x <= size.width + 4 {
                            let m = mask.at(x / size.width, (y0 - top) / span)
                            let calm = sin(x * 0.03 + t * 1.6 + Double(i) * 0.5) * 4 * (1 - e * 0.6)
                            let y = y0 + calm - m * step * 1.9 * e
                            x == 0 ? p.move(to: CGPoint(x: x, y: y)) : p.addLine(to: CGPoint(x: x, y: y))
                            x += 4
                        }
                        ctx.stroke(p, with: .color(waveColors[i % waveColors.count].opacity(0.35 + 0.6 * e)), lineWidth: 2)
                    }
                }
            }
            .ignoresSafeArea()
            VStack(spacing: 10) {
                Text(scene.title).font(Nyao.title(30)).foregroundStyle(.white)
                Text(scene.text).font(.system(size: 15)).foregroundStyle(Color(hex: "#C9C9CE")).multilineTextAlignment(.center)
                Button("Слушать дальше", action: close)
                    .buttonStyle(.borderedProminent).tint(Nyao.accent).foregroundStyle(Nyao.ink).padding(.top, 8)
            }
            .padding(.horizontal, 24).padding(.bottom, 48)
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: close)
    }
}
