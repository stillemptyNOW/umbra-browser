package io.umbra.browser

import android.net.Uri
import java.net.URLEncoder

/** Turning what someone typed into something to load. */
object Urls {

    private val scheme = Regex("^[a-z][a-z0-9+.\\-]*:", RegexOption.IGNORE_CASE)
    private val known = Regex("^(https?|about|file|data):", RegexOption.IGNORE_CASE)
    private val hostLike = Regex("^[^\\s/?#@]+\\.[a-z]{2,63}(:\\d{1,5})?([/?#]|$)", RegexOption.IGNORE_CASE)
    private val localhost = Regex("^(localhost|127\\.0\\.0\\.1|10\\.0\\.2\\.2)(:\\d+)?([/?#]|$)", RegexOption.IGNORE_CASE)

    val engines = linkedMapOf(
        "duckduckgo" to "https://duckduckgo.com/?q=%s",
        "startpage" to "https://www.startpage.com/sp/search?query=%s",
        "brave" to "https://search.brave.com/search?q=%s",
        "mojeek" to "https://www.mojeek.com/search?q=%s",
    )

    /**
     * Anything that is not plausibly an address becomes a search. A typo should
     * never turn into a DNS lookup somebody can watch.
     */
    fun resolve(input: String, searchTemplate: String): String? {
        val text = input.trim()
        if (text.isEmpty()) return null
        if (known.containsMatchIn(text)) return text
        if (scheme.containsMatchIn(text) && !text.contains(' ')) return text
        if (localhost.containsMatchIn(text)) return "http://$text"
        if (hostLike.containsMatchIn(text) && !text.contains(' ')) return "https://$text"
        return searchTemplate.replace("%s", URLEncoder.encode(text, "UTF-8"))
    }

    /** Address-bar text: no scheme noise, no bare trailing slash. */
    fun pretty(url: String?): String {
        if (url.isNullOrEmpty()) return ""
        val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return url
        val host = uri.host ?: return url
        val path = uri.path.orEmpty().let { if (it == "/") "" else it }
        val query = uri.query?.let { "?$it" }.orEmpty()
        return if (uri.scheme == "https") "$host$path$query" else "${uri.scheme}://$host$path$query"
    }

    fun isSecure(url: String?): Boolean =
        url != null && (url.startsWith("https://") || url.startsWith("about:"))
}
