package org.nyao.music.spotify

import android.content.Context

/** Всё про Spotify в одном месте: вход, Web API и устройство-плеер */
object Spotify {
    lateinit var auth: SpotifyAuth
        private set
    lateinit var api: SpotifyApi
        private set
    lateinit var engine: SpotifyEngine
        private set

    fun init(context: Context) {
        if (::auth.isInitialized) return
        auth = SpotifyAuth(context)
        api = SpotifyApi(auth)
        engine = SpotifyEngine(context, auth, api)
    }

    val loggedIn: Boolean get() = ::auth.isInitialized && auth.loggedIn.value

    /**
     * Почему плеер Spotify сейчас не может играть сам: "account" (нет Premium), "init" (нет Widevine) и т.п.
     * Тогда треки Spotify играют найденной копией из другого сервиса. Сбрасывается при новом входе/выходе.
     */
    @Volatile var blocked: String? = null
}
