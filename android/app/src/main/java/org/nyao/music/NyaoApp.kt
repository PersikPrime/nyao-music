package org.nyao.music

import android.app.Application
import org.nyao.music.data.Repo

class NyaoApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Repo.init(this)
        // картинки: если CDN режут (без VPN), Coil берёт их через сервер Nyao
        coil3.SingletonImageLoader.setSafe { ctx ->
            coil3.ImageLoader.Builder(ctx)
                .components { add(coil3.network.okhttp.OkHttpNetworkFetcherFactory(callFactory = { org.nyao.music.data.ImageProxy.client })) }
                .build()
        }
        org.nyao.music.playback.Friends.init(this)
    }
}
