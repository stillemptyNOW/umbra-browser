package io.umbra.browser

import android.app.Application
import org.mozilla.geckoview.ContentBlocking
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoRuntimeSettings
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSessionSettings

/**
 * One GeckoRuntime per process. GeckoView is a real browser engine (the same
 * family as Firefox), shipped inside the APK — not the system WebView.
 */
object Engine {

    @Volatile
    private var runtime: GeckoRuntime? = null

    fun runtime(app: Application): GeckoRuntime {
        runtime?.let { return it }
        synchronized(this) {
            runtime?.let { return it }
            val settings = GeckoRuntimeSettings.Builder()
                .aboutConfigEnabled(false)
                .consoleOutput(false)
                .remoteDebuggingEnabled(BuildConfig.DEBUG)
                .forceUserScalableEnabled(true)
                .preferredColorScheme(GeckoRuntimeSettings.COLOR_SCHEME_DARK)
                .allowInsecureConnections(GeckoRuntimeSettings.HTTPS_ONLY)
                .contentBlocking(
                    ContentBlocking.Settings.Builder()
                        .antiTracking(ContentBlocking.AntiTracking.STRICT)
                        .cookieBehavior(ContentBlocking.CookieBehavior.ACCEPT_FIRST_PARTY_AND_ISOLATE_OTHERS)
                        .enhancedTrackingProtectionLevel(ContentBlocking.EtpLevel.STRICT)
                        .strictSocialTrackingProtection(true)
                        .safeBrowsing(ContentBlocking.SafeBrowsing.NONE)
                        .build()
                )
                .build()
            val created = GeckoRuntime.create(app, settings)
            runtime = created
            return created
        }
    }

    fun newSession(privateMode: Boolean = false, desktop: Boolean = false): GeckoSession {
        val settings = GeckoSessionSettings.Builder()
            .usePrivateMode(privateMode)
            .userAgentMode(
                if (desktop) GeckoSessionSettings.USER_AGENT_MODE_DESKTOP
                else GeckoSessionSettings.USER_AGENT_MODE_MOBILE
            )
            .viewportMode(
                if (desktop) GeckoSessionSettings.VIEWPORT_MODE_DESKTOP
                else GeckoSessionSettings.VIEWPORT_MODE_MOBILE
            )
            .suspendMediaWhenInactive(true)
            .allowJavascript(true)
            .build()
        return GeckoSession(settings)
    }
}
