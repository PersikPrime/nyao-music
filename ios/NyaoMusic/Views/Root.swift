import SwiftUI

@main
struct NyaoMusicApp: App {
    @StateObject private var repo = Repo.shared
    @StateObject private var player = Player.shared
    @StateObject private var hundred = Hundred.shared
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(repo)
                .environmentObject(player)
                .environmentObject(hundred)
                .preferredColorScheme(.dark)
                .tint(Nyao.accent)
                .task {
                    await repo.refreshAccounts()
                    await repo.loadLibrary()
                    await repo.cloud.flush()
                }
                .onChange(of: phase) { _, p in if p == .active { Task { await repo.cloud.flush() } } }
        }
    }
}

enum Tab: Hashable { case home, wave, library, friends, search, settings }

/// Маршруты внутри вкладки
enum Route: Hashable {
    case playlist(Playlist)
    case liked
    case user(String)
    case settings
}

struct RootView: View {
    @EnvironmentObject var repo: Repo
    @EnvironmentObject var player: Player
    @EnvironmentObject var hundred: Hundred
    @Environment(\.horizontalSizeClass) private var hsize
    @State private var tab: Tab = .home
    @State private var nowPlaying = false

    var body: some View {
        Group {
            if !repo.prefs.onboarded && !repo.anyService {
                Onboarding()
            } else if hsize == .regular {
                PadLayout(tab: $tab)
            } else {
                PhoneLayout(tab: $tab, nowPlaying: $nowPlaying)
            }
        }
        .background(Nyao.bg)
        .overlay(alignment: .top) {
            if let t = repo.toast {
                Text(t).font(.system(size: 14, weight: .medium)).padding(.horizontal, 16).padding(.vertical, 10)
                    .glass(20).padding(.top, 8).padding(.horizontal, 16)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .onTapGesture { repo.toast = nil }
            }
        }
        .animation(.spring(duration: 0.3), value: repo.toast)
        .fullScreenCover(item: $hundred.scene) { s in HundredView(scene: s) { hundred.scene = nil } }
        .task {
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            if repo.anyService { hundred.maybeFirstRun() }
        }
    }
}

// MARK: - iPhone: плавающая стеклянная панель вкладок и мини-плеер

struct PhoneLayout: View {
    @Binding var tab: Tab
    @Binding var nowPlaying: Bool
    @EnvironmentObject var player: Player

    var body: some View {
        TabView(selection: $tab) {
            NavigationStack { HomeView().routes() }
                .tabItem { Label("Главная", systemImage: "house") }.tag(Tab.home)
            NavigationStack { WaveView() }
                .tabItem { Label("Волна", systemImage: "waveform") }.tag(Tab.wave)
            NavigationStack { LibraryView().routes() }
                .tabItem { Label("Медиатека", systemImage: "books.vertical") }.tag(Tab.library)
            NavigationStack { FriendsView().routes() }
                .tabItem { Label("Друзья", systemImage: "person.2") }.tag(Tab.friends)
            NavigationStack { SearchView().routes() }
                .tabItem { Label("Поиск", systemImage: "magnifyingglass") }.tag(Tab.search)
        }
        .safeAreaInset(edge: .bottom) {
            if player.current != nil {
                MiniPlayer { nowPlaying = true }.padding(.horizontal, 12).padding(.bottom, 56)
            }
        }
        .sheet(isPresented: $nowPlaying) { NowPlayingView().presentationDragIndicator(.visible) }
    }
}

// MARK: - iPad: боковая панель, содержимое и плеер справа

struct PadLayout: View {
    @Binding var tab: Tab
    @EnvironmentObject var repo: Repo
    @EnvironmentObject var player: Player
    @State private var side: Tab? = .home

    var body: some View {
        NavigationSplitView {
            List(selection: $side) {
                Label("Главная", systemImage: "house").tag(Tab.home)
                Label("Моя волна", systemImage: "waveform").tag(Tab.wave)
                Label("Поиск", systemImage: "magnifyingglass").tag(Tab.search)
                Label("Медиатека", systemImage: "books.vertical").tag(Tab.library)
                Label("Друзья", systemImage: "person.2").tag(Tab.friends)
                Label("Настройки", systemImage: "gearshape").tag(Tab.settings)
            }
            .navigationTitle("Nyao Music")
        } detail: {
            HStack(spacing: 0) {
                NavigationStack {
                    switch side ?? .home {
                    case .home: HomeView().routes()
                    case .wave: WaveView()
                    case .search: SearchView().routes()
                    case .library: LibraryView().routes()
                    case .friends: FriendsView().routes()
                    case .settings: SettingsView()
                    }
                }
                .frame(maxWidth: .infinity)
                if player.current != nil {
                    Divider()
                    NowPlayingView(compact: true).frame(width: 360)
                }
            }
        }
    }
}

extension View {
    func routes() -> some View {
        navigationDestination(for: Route.self) { r in
            switch r {
            case .playlist(let p): PlaylistView(playlist: p)
            case .liked: LikedView()
            case .user(let id): UserView(key: id)
            case .settings: SettingsView()
            }
        }
    }
}

struct MiniPlayer: View {
    let open: () -> Void
    @EnvironmentObject var player: Player

    var body: some View {
        if let t = player.current {
            HStack(spacing: 10) {
                CoverView(url: t.cover, key: t.id, radius: 22).frame(width: 44, height: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text(t.title).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                    HStack(spacing: 5) {
                        SourceBadge(source: t.source)
                        Text(t.artist).font(.system(size: 12)).foregroundStyle(Nyao.muted).lineLimit(1)
                    }
                }
                Spacer(minLength: 4)
                if player.loading { ProgressView().frame(width: 40) } else {
                    Button { player.toggle() } label: { Image(systemName: player.isPlaying ? "pause.fill" : "play.fill").font(.system(size: 20)).frame(width: 40, height: 40) }
                }
                Button { player.next() } label: { Image(systemName: "forward.fill").font(.system(size: 18)).frame(width: 40, height: 40) }
            }
            .foregroundStyle(Nyao.text)
            .padding(.leading, 7).padding(.trailing, 8).frame(height: 58)
            .glass(29)
            .contentShape(Rectangle())
            .onTapGesture(perform: open)
        }
    }
}

struct Onboarding: View {
    @EnvironmentObject var repo: Repo
    @State private var login: String?

    var body: some View {
        VStack(spacing: 18) {
            Spacer()
            RoundedRectangle(cornerRadius: 26, style: .continuous).fill(Color(hex: "#17142A")).frame(width: 96, height: 96)
                .overlay(Image(systemName: "waveform").font(.system(size: 46, weight: .bold)).foregroundStyle(Nyao.accent))
            Text("Nyao Music").font(Nyao.title(32))
            Text("Яндекс, VK и SoundCloud в одном плеере.\nВойди хотя бы в один сервис.").multilineTextAlignment(.center).foregroundStyle(Nyao.muted)
            Spacer()
            VStack(spacing: 10) {
                ForEach(Source.all, id: \.self) { s in
                    Button { login = s } label: {
                        HStack { SourceBadge(source: s); Text("Войти: \(Source.name(s))").fontWeight(.semibold); Spacer(); Image(systemName: "chevron.right") }
                            .padding(.horizontal, 18).frame(height: 54).background(Nyao.surface, in: RoundedRectangle(cornerRadius: 27))
                    }
                    .foregroundStyle(Nyao.text)
                }
                Button("Пропустить") { repo.prefs.onboarded = true; repo.objectWillChange.send() }.foregroundStyle(Nyao.muted).padding(.top, 6)
            }
            .padding(.horizontal, 20).padding(.bottom, 24)
        }
        .sheet(item: Binding(get: { login.map(LoginItem.init) }, set: { login = $0?.id })) { item in
            LoginView(source: item.id) { ok in login = nil; if ok { repo.prefs.onboarded = true } }
        }
    }
}

struct LoginItem: Identifiable { let id: String }
