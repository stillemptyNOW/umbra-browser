package io.umbra.browser

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.util.concurrent.atomic.AtomicInteger

/**
 * Host-level request blocking.
 *
 * Android's WebView gives no equivalent of Chromium's declarative net request
 * API, so this matches on registrable-domain suffixes rather than running full
 * filter-list syntax. That catches the trackers that matter without pretending
 * to be uBlock Origin — see PRIVACY.md for exactly what the mobile build does
 * and does not do compared with the desktop one.
 */
object Blocker {

    private val blocked = HashSet<String>(4096)

    /** Entries like `example.com/track` — domain match plus a path prefix. */
    private val pathRules = mutableListOf<Pair<String, String>>()

    private val sessionCount = AtomicInteger(0)
    private var pageCount = AtomicInteger(0)

    /** Query parameters that exist only to attribute a click to a campaign. */
    private val trackingParams = setOf(
        "gclid", "gclsrc", "dclid", "gbraid", "wbraid", "gad_source",
        "fbclid", "msclkid", "twclid", "ttclid", "igshid", "igsh", "yclid", "ysclid",
        "mc_cid", "mc_eid", "mkt_tok", "_openstat", "vero_id", "epik", "rdt_cid",
        "li_fat_id", "irclickid", "s_cid", "ref_src", "spm", "scm", "_ga", "_gl",
        "hsCtaTracking", "__hssc", "__hstc", "__hsfp",
    )

    private val emptyResponse: WebResourceResponse
        get() = WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))

    fun load(context: Context) {
        if (blocked.isNotEmpty()) return
        runCatching {
            context.assets.open("blocklist.txt").bufferedReader().useLines { lines ->
                for (raw in lines) {
                    val line = raw.trim().lowercase()
                    if (line.isEmpty() || line.startsWith("#")) continue
                    val slash = line.indexOf('/')
                    if (slash == -1) {
                        blocked.add(line)
                    } else {
                        pathRules.add(line.substring(0, slash) to line.substring(slash))
                    }
                }
            }
        }
    }

    /** True when the host, or any parent domain of it, is on the list. */
    fun shouldBlock(url: String): Boolean {
        val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return false
        val host = uri.host?.lowercase() ?: return false

        if (matchesDomain(host)) return true

        if (pathRules.isNotEmpty()) {
            val path = uri.path.orEmpty().lowercase()
            for ((domain, prefix) in pathRules) {
                if (path.startsWith(prefix) && (host == domain || host.endsWith(".$domain"))) {
                    return true
                }
            }
        }
        return false
    }

    private fun matchesDomain(host: String): Boolean {
        if (blocked.contains(host)) return true
        var index = host.indexOf('.')
        while (index in 0 until host.length - 1) {
            if (blocked.contains(host.substring(index + 1))) return true
            index = host.indexOf('.', index + 1)
        }
        return false
    }

    fun intercept(url: String): WebResourceResponse? {
        if (!shouldBlock(url)) return null
        sessionCount.incrementAndGet()
        pageCount.incrementAndGet()
        return emptyResponse
    }

    /** Strip campaign parameters, and upgrade the scheme while we are here. */
    fun cleanUrl(url: String): String {
        val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return url
        val scheme = if (uri.scheme == "http" && !isLocal(uri.host)) "https" else uri.scheme

        val names = runCatching { uri.queryParameterNames }.getOrDefault(emptySet())
        val offenders = names.filter { it in trackingParams || it.startsWith("utm_") }
        if (offenders.isEmpty() && scheme == uri.scheme) return url

        val builder = uri.buildUpon().scheme(scheme).clearQuery()
        for (name in names) {
            if (name in offenders) continue
            for (value in uri.getQueryParameters(name)) builder.appendQueryParameter(name, value)
        }
        return builder.build().toString()
    }

    private fun isLocal(host: String?): Boolean {
        if (host == null) return false
        return host == "localhost" || host.endsWith(".local") || host.endsWith(".onion") ||
            host == "127.0.0.1" || host == "10.0.2.2"
    }

    fun sessionBlocked(): Int = sessionCount.get()
    fun pageBlocked(): Int = pageCount.get()
    fun resetPage() = pageCount.set(0)
}
