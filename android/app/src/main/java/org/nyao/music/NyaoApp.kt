package org.nyao.music

import android.app.Application
import org.nyao.music.data.Repo

class NyaoApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Repo.init(this)
    }
}
