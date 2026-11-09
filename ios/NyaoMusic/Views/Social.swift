import SwiftUI

// MARK: - Друзья

struct FriendsView: View {
    @EnvironmentObject var repo: Repo
    @EnvironmentObject var player: Player
    @State private var friends: [Friend] = []
    @State private var incoming: [UserCard] = []
    @State private var inbox: [InboxItem] = []
    @State private var loading = false
    @State private var error: String?
    @State private var addNick = ""
    @State private var login = false

    var body: some View {
        Group {
            if repo.cloudUser == nil {
                VStack(spacing: 14) {
                    Image(systemName: "person.2.circle").font(.system(size: 56)).foregroundStyle(Nyao.accent)
                    Text("Друзья в Nyao").font(Nyao.title(22))
                    Text("Войди через Telegram — увидишь, что слушают друзья, и сможешь делиться треками.").multilineTextAlignment(.center).foregroundStyle(Nyao.muted)
                    Button("Войти через Telegram") { login = true }.buttonStyle(.borderedProminent).foregroundStyle(Nyao.ink)
                }
                .padding(32)
            } else {
                List {
                    let live = friends.filter { $0.now?.playing == true }
                    if !live.isEmpty {
                        Section("Сейчас слушают") {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 12) { ForEach(live) { f in LiveCard(friend: f) } }.padding(.vertical, 4)
                            }
                            .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                        }
                    }
                    if !incoming.isEmpty {
                        Section("Заявки") {
                            ForEach(incoming) { u in
                                HStack {
                                    Avatar(user: u, size: 40)
                                    Text(u.display).font(.system(size: 15, weight: .semibold))
                                    Spacer()
                                    Button("Принять") { Task { try? await repo.cloud.acceptFriend(u.id); await load() } }.buttonStyle(.borderedProminent).foregroundStyle(Nyao.ink)
                                }
                            }
                        }
                    }
                    Section("Все друзья · \(friends.count)") {
                        ForEach(friends) { f in
                            NavigationLink(value: Route.user(f.user.id)) {
                                HStack(spacing: 12) {
                                    Avatar(user: f.user, size: 44)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(f.user.display).font(.system(size: 15, weight: .semibold))
                                        Text(status(f)).font(.system(size: 13)).foregroundStyle(f.online ? Color(hex: "#5BD69A") : Nyao.muted).lineLimit(1)
                                    }
                                }
                            }
                        }
                        HStack {
                            TextField("Ник друга", text: $addNick).textInputAutocapitalization(.never).autocorrectionDisabled()
                            Button("Добавить") {
                                let n = addNick.trimmingCharacters(in: CharacterSet(charactersIn: "@ "))
                                Task {
                                    do { try await repo.cloud.requestFriend(nick: n); repo.show("Заявка отправлена"); addNick = "" } catch { repo.show(error.localizedDescription) }
                                }
                            }
                            .disabled(addNick.count < 2)
                        }
                    }
                    if !inbox.isEmpty {
                        Section("Входящие") {
                            ForEach(groupInbox(inbox)) { g in
                                HStack(spacing: 10) {
                                    if let u = g.item.from { Avatar(user: u, size: 34) }
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(inboxText(g)).font(.system(size: 14))
                                        if let t = g.item.track { Text("\(t.title) — \(t.artist)").font(.system(size: 12)).foregroundStyle(Nyao.muted).lineLimit(1) }
                                    }
                                    Spacer()
                                    if let t = g.item.track { Button { player.play([t]) } label: { Image(systemName: "play.circle.fill").font(.system(size: 26)) } }
                                }
                            }
                        }
                    }
                    if let error { Text(error).foregroundStyle(Nyao.muted) }
                }
                .refreshable { await load() }
                .task { await load() }
            }
        }
        .navigationTitle("Друзья")
        .sheet(isPresented: $login) { NyaoLoginView { login = false } }
    }

    private func status(_ f: Friend) -> String {
        if let n = f.now, n.playing { return "♫ \(n.track.title) — \(n.track.artist)" }
        return f.online ? "в сети" : "не в сети"
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let r = try await repo.cloud.friends()
            friends = r.friends.sorted { ($0.now?.playing == true ? 0 : $0.online ? 1 : 2) < ($1.now?.playing == true ? 0 : $1.online ? 1 : 2) }
            incoming = r.incoming
            inbox = (try? await repo.cloud.inbox()) ?? []
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    struct InboxGroup: Identifiable { var item: InboxItem; var count: Int; var id: String { item.id } }

    /// Одинаковые реакции подряд — одной строкой «×N», как на ПК и Android
    private func groupInbox(_ items: [InboxItem]) -> [InboxGroup] {
        var out: [InboxGroup] = []
        for i in items {
            if let last = out.last, last.item.kind == "react", i.kind == "react", last.item.from?.id == i.from?.id, last.item.emoji == i.emoji, last.item.track?.id == i.track?.id {
                out[out.count - 1].count += 1
            } else {
                out.append(InboxGroup(item: i, count: 1))
            }
        }
        return out
    }

    private func inboxText(_ g: InboxGroup) -> String {
        let who = g.item.from?.display ?? "Кто-то"
        switch g.item.kind {
        case "react": return "\(who): \(g.item.emoji ?? "❤️")" + (g.count > 1 ? " ×\(g.count)" : "")
        case "share": return "\(who) поделился треком"
        case "friend": return "\(who) хочет дружить"
        case "accepted": return "\(who) принял заявку"
        case "invite": return "\(who) зовёт слушать вместе"
        default: return who
        }
    }
}

struct LiveCard: View {
    let friend: Friend
    @EnvironmentObject var player: Player
    var body: some View {
        let color = Color(hex: friend.user.color ?? "#C6B8FF")
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) { Avatar(user: friend.user, size: 30); Text(friend.user.display).font(.system(size: 13, weight: .semibold)).lineLimit(1) }
            if let t = friend.now?.track {
                CoverView(url: t.cover, key: t.id, radius: 18).frame(width: 144, height: 144)
                VStack(alignment: .leading, spacing: 2) {
                    Text(t.title).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                    Text(t.artist).font(.system(size: 12)).foregroundStyle(Nyao.muted).lineLimit(1)
                }
                Button { player.play([t], label: "От \(friend.user.display)") } label: {
                    Text("Включить себе").font(.system(size: 13, weight: .semibold)).frame(maxWidth: .infinity).frame(height: 34)
                        .background(color, in: Capsule()).foregroundStyle(Nyao.ink)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(12).frame(width: 168)
        .background(Nyao.surface, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).stroke(Nyao.line))
    }
}

// MARK: - Профиль друга

struct UserView: View {
    let key: String
    @EnvironmentObject var repo: Repo
    @EnvironmentObject var player: Player
    @Environment(\.openURL) private var openURL
    @State private var p: PublicProfile?
    @State private var error: String?

    var body: some View {
        ScrollView {
            if let p {
                let color = Color(hex: p.user.color ?? "#C6B8FF")
                VStack(alignment: .leading, spacing: 16) {
                    ZStack {
                        if let b = p.banner, let u = URL(string: b) {
                            AsyncImage(url: u) { $0.resizable().scaledToFill() } placeholder: { color.opacity(0.2) }
                        } else {
                            color.opacity(0.18)
                            CookieShape().stroke(color.opacity(0.5), lineWidth: 1.5).frame(width: 260, height: 260).offset(x: 120, y: -40)
                        }
                    }
                    .frame(height: 170).frame(maxWidth: .infinity).clipped()
                    HStack(alignment: .bottom, spacing: 14) {
                        Avatar(user: p.user, size: 104).padding(5).background(AvatarShape(kind: p.user.shape).fill(.black))
                        Spacer()
                    }
                    .padding(.horizontal, 20).padding(.top, -70)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(p.user.display).font(Nyao.title(26))
                        Text("@\(p.user.nick)" + (p.isPrivate ? "" : " · \(p.friends) \(plural(p.friends, "друг", "друга", "друзей"))")).foregroundStyle(Nyao.muted)
                        if !p.bio.isEmpty { Text(p.bio).padding(.top, 6).foregroundStyle(Color(hex: "#C9C9CE")) }
                    }
                    .padding(.horizontal, 20)
                    if !p.links.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack { ForEach(p.links, id: \.url) { l in
                                Button { if let u = URL(string: l.url) { openURL(u) } } label: {
                                    Text(linkName(l)).font(.system(size: 13)).padding(.horizontal, 14).frame(height: 34).background(Nyao.surface, in: Capsule()).overlay(Capsule().stroke(Nyao.line))
                                }
                                .foregroundStyle(Nyao.text)
                            } }
                            .padding(.horizontal, 20)
                        }
                    }
                    if let t = p.statusTrack { trackCard("ПРОФИЛЬНЫЙ ТРЕК", t, color) }
                    if let n = p.now { trackCard(n.playing ? "СЕЙЧАС СЛУШАЕТ" : "СЛУШАЛ НЕДАВНО", n.track, color) }
                    if !p.topArtists.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Text("Чаще всего за месяц").font(.system(size: 17, weight: .bold))
                                Spacer()
                                Text(p.minutes >= 60 ? "\(p.minutes / 60) ч" : "\(p.minutes) мин").font(.system(size: 13)).foregroundStyle(Nyao.muted)
                            }
                            ForEach(p.topArtists.prefix(5), id: \.name) { a in
                                HStack { Text(a.name).font(.system(size: 15, weight: .semibold)); Spacer(); Text("\(a.plays)").foregroundStyle(Nyao.muted) }
                            }
                        }
                        .padding(.horizontal, 20)
                    }
                    if !p.badges.isEmpty {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 84))], spacing: 12) {
                            ForEach(p.badges) { b in
                                VStack(spacing: 6) {
                                    ZStack {
                                        CookieShape(lobes: 12, amp: 0.06).fill(b.tone == "accent" ? color : Color(hex: "#1E2A44"))
                                        Text(b.mark).font(.system(size: b.mark.count >= 3 ? 16 : 22, weight: .heavy, design: .rounded)).foregroundStyle(b.tone == "accent" ? Nyao.ink : Color(hex: "#9FC2FF"))
                                    }
                                    .frame(width: 60, height: 60)
                                    Text(b.title).font(.system(size: 11)).foregroundStyle(Nyao.muted).multilineTextAlignment(.center).lineLimit(3)
                                }
                            }
                        }
                        .padding(.horizontal, 20)
                    }
                    Spacer(minLength: 90)
                }
            } else if let error {
                Text(error).foregroundStyle(Nyao.muted).padding(40)
            } else {
                ProgressView().padding(60)
            }
        }
        .ignoresSafeArea(edges: .top)
        .task { do { p = try await repo.cloud.user(key) } catch { self.error = error.localizedDescription } }
    }

    private func trackCard(_ label: String, _ t: Track, _ color: Color) -> some View {
        HStack(spacing: 14) {
            CoverView(url: t.cover, key: t.id, radius: 14).frame(width: 60, height: 60)
            VStack(alignment: .leading, spacing: 3) {
                Text(label).font(.system(size: 11, weight: .semibold)).tracking(1).foregroundStyle(color)
                Text(t.title).font(.system(size: 15, weight: .semibold)).lineLimit(1)
                HStack(spacing: 5) { SourceBadge(source: t.source); Text(t.artist).font(.system(size: 13)).foregroundStyle(Nyao.muted).lineLimit(1) }
            }
            Spacer()
            Button { player.play([t]) } label: {
                Image(systemName: "play.fill").foregroundStyle(.black).frame(width: 44, height: 44).background(Nyao.text, in: Circle())
            }
        }
        .padding(12)
        .background(Nyao.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(.horizontal, 20)
    }

    private func linkName(_ l: ProfileLink) -> String {
        let names = ["telegram": "Telegram", "vk": "ВКонтакте", "youtube": "YouTube", "soundcloud": "SoundCloud", "spotify": "Spotify", "yandex": "Яндекс Музыка",
                     "instagram": "Instagram", "tiktok": "TikTok", "x": "X", "twitch": "Twitch", "github": "GitHub", "discord": "Discord"]
        return names[l.kind] ?? l.url.replacingOccurrences(of: "https://", with: "")
    }
}

// MARK: - Настройки

struct SettingsView: View {
    @EnvironmentObject var repo: Repo
    @EnvironmentObject var hundred: Hundred
    @State private var login: String?
    @State private var nyaoLogin = false

    var version: String {
        let v = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.8"
        let b = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "100"
        // сборки канала nightly называются Nyao Music Red (имя ставит CI): «Red · 106»
        let name = Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? ""
        if name.hasSuffix("Red") { return "Red · \(b)" }
        return "\(v) (\(b))"
    }

    var body: some View {
        List {
            Section("Сервисы") {
                ForEach(Source.all, id: \.self) { s in
                    HStack {
                        SourceBadge(source: s)
                        VStack(alignment: .leading) {
                            Text(Source.name(s))
                            if let a = repo.accounts[s] { Text(a.name).font(.system(size: 12)).foregroundStyle(Nyao.muted) }
                        }
                        Spacer()
                        if repo.loggedIn(s) {
                            Button("Выйти", role: .destructive) { Task { await repo.logout(s) } }
                        } else {
                            Button("Войти") { login = s }
                        }
                    }
                }
                HStack {
                    SourceBadge(source: Source.yt)
                    Text("YouTube Music и Spotify").foregroundStyle(Nyao.muted)
                    Spacer()
                    Text("скоро").font(.system(size: 12)).foregroundStyle(Nyao.muted)
                }
            }
            Section("Аккаунт Nyao") {
                if let u = repo.cloudUser {
                    HStack {
                        Text(u.name)
                        Spacer()
                        Button("Выйти", role: .destructive) { Task { await repo.cloud.logout(); repo.cloudUser = nil } }
                    }
                } else {
                    Button("Войти через Telegram") { nyaoLogin = true }
                }
                Text("История, друзья и «сейчас играет». Входы в музыкальные сервисы остаются на этом устройстве.").font(.system(size: 12)).foregroundStyle(Nyao.muted)
            }
            Section("О приложении") {
                HStack {
                    Text("Nyao Music")
                    Spacer()
                    Text(version).foregroundStyle(Nyao.muted).onTapGesture { hundred.tapVersion() }
                }
                Text("Неофициальный клиент: сервисы подключены через их внутренние API — после их обновлений что-то может сломаться. Ставится через SideStore, подпись продлевается раз в 7 дней.")
                    .font(.system(size: 12)).foregroundStyle(Nyao.muted)
            }
        }
        .navigationTitle("Настройки")
        .sheet(item: Binding(get: { login.map(LoginItem.init) }, set: { login = $0?.id })) { item in LoginView(source: item.id) { _ in login = nil } }
        .sheet(isPresented: $nyaoLogin) { NyaoLoginView { nyaoLogin = false } }
    }
}
