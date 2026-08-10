package io.umbra.browser

import android.content.Context
import android.content.SharedPreferences

/** Local preferences. There is no account and nothing syncs anywhere. */
class Prefs(context: Context) {

    private val store: SharedPreferences =
        context.getSharedPreferences("umbra", Context.MODE_PRIVATE)

    var blockTrackers: Boolean
        get() = store.getBoolean("blockTrackers", true)
        set(value) = store.edit().putBoolean("blockTrackers", value).apply()

    var httpsOnly: Boolean
        get() = store.getBoolean("httpsOnly", true)
        set(value) = store.edit().putBoolean("httpsOnly", value).apply()

    var fingerprintDefense: Boolean
        get() = store.getBoolean("fingerprintDefense", true)
        set(value) = store.edit().putBoolean("fingerprintDefense", value).apply()

    var blockThirdPartyCookies: Boolean
        get() = store.getBoolean("blockThirdPartyCookies", true)
        set(value) = store.edit().putBoolean("blockThirdPartyCookies", value).apply()

    var clearOnExit: Boolean
        get() = store.getBoolean("clearOnExit", false)
        set(value) = store.edit().putBoolean("clearOnExit", value).apply()

    var desktopSite: Boolean
        get() = store.getBoolean("desktopSite", false)
        set(value) = store.edit().putBoolean("desktopSite", value).apply()

    var searchEngine: String
        get() = store.getString("searchEngine", "duckduckgo") ?: "duckduckgo"
        set(value) = store.edit().putString("searchEngine", value).apply()

    val searchTemplate: String
        get() = Urls.engines[searchEngine] ?: Urls.engines.getValue("duckduckgo")

    /**
     * Per-install random, mixed with the hostname to seed the fingerprinting
     * defence. Kept out of backups along with everything else, so reinstalling
     * gives a clean identity.
     */
    val installSeed: String
        get() = store.getString("installSeed", null) ?: run {
            val generated = java.util.UUID.randomUUID().toString()
            store.edit().putString("installSeed", generated).apply()
            generated
        }
}
