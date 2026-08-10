package io.umbra.browser

import android.app.Application
import android.webkit.CookieManager
import android.webkit.WebView

class UmbraApp : Application() {

    override fun onCreate() {
        super.onCreate()
        Blocker.load(this)

        // Third-party cookies are refused process-wide, not just per WebView.
        CookieManager.getInstance().setAcceptCookie(true)

        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
    }
}
