package io.umbra.browser

import android.app.Application

class UmbraApp : Application() {

    override fun onCreate() {
        super.onCreate()
        Blocker.load(this)
        Engine.runtime(this)
    }
}
