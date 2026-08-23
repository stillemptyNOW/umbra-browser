package io.umbra.browser

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.PopupMenu
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import io.umbra.browser.databinding.ActivityMainBinding

class Tab(val webView: WebView) {
    var title: String = ""
    var url: String = ""
}

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var prefs: Prefs

    private val tabs = mutableListOf<Tab>()
    private var current = -1
    private var startScript: String = ""

    private val activeTab: Tab? get() = tabs.getOrNull(current)

    /** A plain Chrome build. Announcing Umbra would be a near-unique signal. */
    private val genericUserAgent: String by lazy {
        val chromeVersion = WebViewCompat.getCurrentWebViewPackage(this)
            ?.versionName?.substringBefore('.') ?: "131"
        "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Chrome/$chromeVersion.0.0.0 Mobile Safari/537.36"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        prefs = Prefs(this)
        startScript = runCatching {
            assets.open("farble.js").bufferedReader().use { it.readText() }
                .replace("__UMBRA_SECRET__", prefs.installSeed)
        }.getOrDefault("")

        wireChrome()

        val initial = intent?.dataString ?: HOME
        newTab(initial)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    binding.tabSheet.isVisible() -> showTabSheet(false)
                    activeTab?.webView?.canGoBack() == true -> activeTab?.webView?.goBack()
                    tabs.size > 1 -> closeTab(current)
                    else -> finish()
                }
            }
        })
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.dataString?.let { newTab(it) }
    }

    // -- chrome ---------------------------------------------------------------

    private fun wireChrome() {
        binding.back.setOnClickListener {
            activeTab?.webView?.takeIf { it.canGoBack() }?.goBack()
        }
        binding.forward.setOnClickListener {
            activeTab?.webView?.takeIf { it.canGoForward() }?.goForward()
        }
        binding.reload.setOnClickListener { activeTab?.webView?.reload() }
        binding.newTab.setOnClickListener { newTab(HOME) }
        binding.tabsButton.setOnClickListener { showTabSheet(!binding.tabSheet.isVisible()) }
        binding.menu.setOnClickListener { showMenu() }
        binding.shield.setOnClickListener { showShield() }

        binding.omnibox.setOnEditorActionListener { view, actionId, event ->
            val go = actionId == EditorInfo.IME_ACTION_GO ||
                event?.keyCode == KeyEvent.KEYCODE_ENTER
            if (go) {
                Urls.resolve(view.text.toString(), prefs.searchTemplate)?.let { load(it) }
                hideKeyboard()
                view.clearFocus()
            }
            go
        }

        binding.tabList.layoutManager = LinearLayoutManager(this)
        binding.tabList.adapter = TabAdapter(
            tabs,
            onSelect = { index -> showTab(index); showTabSheet(false) },
            onClose = { index -> closeTab(index) },
        )
    }

    private fun View.isVisible() = visibility == View.VISIBLE

    private fun showTabSheet(show: Boolean) {
        binding.tabSheet.visibility = if (show) View.VISIBLE else View.GONE
        binding.webContainer.visibility = if (show) View.GONE else View.VISIBLE
        binding.tabList.adapter?.notifyDataSetChanged()
    }

    private fun hideKeyboard() {
        val service = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
        service.hideSoftInputFromWindow(binding.omnibox.windowToken, 0)
    }

    private fun refreshChrome() {
        val tab = activeTab
        if (binding.omnibox.hasFocus().not()) {
            binding.omnibox.setText(Urls.pretty(tab?.url))
        }
        binding.back.isEnabled = tab?.webView?.canGoBack() == true
        binding.forward.isEnabled = tab?.webView?.canGoForward() == true
        binding.back.alpha = if (binding.back.isEnabled) 1f else 0.3f
        binding.forward.alpha = if (binding.forward.isEnabled) 1f else 0.3f
        binding.tabCount.text = tabs.size.toString()

        val blocked = Blocker.pageBlocked()
        binding.blockCount.text = if (blocked > 0) blocked.toString() else ""
    }

    // -- tabs -----------------------------------------------------------------

    @SuppressLint("SetJavaScriptEnabled")
    private fun buildWebView(): WebView {
        val webView = WebView(this)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            loadWithOverviewMode = true
            useWideViewPort = true
            builtInZoomControls = true
            displayZoomControls = false
            mediaPlaybackRequiresUserGesture = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            allowFileAccess = false
            allowContentAccess = false
            setGeolocationEnabled(false)
            setSupportMultipleWindows(false)
            userAgentString = if (prefs.desktopSite) {
                genericUserAgent.replace("Android 14; K", "X11; Linux x86_64").replace(" Mobile", "")
            } else {
                genericUserAgent
            }
        }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(webView.settings, true)
        }
        // Safe Browsing is a Google lookup service; Umbra does not use it.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SAFE_BROWSING_ENABLE)) {
            WebSettingsCompat.setSafeBrowsingEnabled(webView.settings, false)
        }
        // Runs before any page script, which is what makes the defence useful.
        if (prefs.fingerprintDefense && startScript.isNotEmpty() &&
            WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        ) {
            runCatching { WebViewCompat.addDocumentStartJavaScript(webView, startScript, setOf("*")) }
        }

        CookieManager.getInstance()
            .setAcceptThirdPartyCookies(webView, !prefs.blockThirdPartyCookies)

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?,
            ): WebResourceResponse? {
                if (!prefs.blockTrackers) return null
                val url = request?.url?.toString() ?: return null
                return Blocker.intercept(url)
            }

            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?,
            ): Boolean {
                val uri = request?.url ?: return false
                val scheme = uri.scheme?.lowercase() ?: return true
                if (scheme == "mailto" || scheme == "tel" || scheme == "sms") {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                    return true
                }
                if (scheme != "http" && scheme != "https") return true
                val raw = uri.toString()
                val cleaned = if (prefs.httpsOnly) Blocker.cleanUrl(raw) else raw
                if (cleaned != raw) {
                    view?.loadUrl(cleaned)
                    return true
                }
                return false
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                Blocker.resetPage()
                activeTab?.url = url.orEmpty()
                binding.progress.visibility = View.VISIBLE
                refreshChrome()
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                activeTab?.url = url.orEmpty()
                activeTab?.title = view?.title.orEmpty()
                binding.progress.visibility = View.GONE
                refreshChrome()
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                binding.progress.progress = newProgress
                if (newProgress >= 100) binding.progress.visibility = View.GONE
            }

            override fun onReceivedTitle(view: WebView?, title: String?) {
                activeTab?.title = title.orEmpty()
            }
        }

        return webView
    }

    private fun newTab(url: String) {
        val tab = Tab(buildWebView())
        tabs.add(tab)
        showTab(tabs.size - 1)
        load(url)
    }

    private fun showTab(index: Int) {
        val tab = tabs.getOrNull(index) ?: return
        current = index
        binding.webContainer.removeAllViews()
        (tab.webView.parent as? android.view.ViewGroup)?.removeView(tab.webView)
        binding.webContainer.addView(tab.webView)
        refreshChrome()
    }

    private fun closeTab(index: Int) {
        val tab = tabs.getOrNull(index) ?: return
        tabs.removeAt(index)
        binding.webContainer.removeView(tab.webView)
        tab.webView.apply { stopLoading(); loadUrl("about:blank"); destroy() }

        if (tabs.isEmpty()) {
            newTab(HOME)
        } else {
            showTab(index.coerceAtMost(tabs.size - 1))
        }
        binding.tabList.adapter?.notifyDataSetChanged()
    }

    private fun load(url: String) {
        val target = if (prefs.httpsOnly) Blocker.cleanUrl(url) else url
        activeTab?.webView?.loadUrl(target)
        activeTab?.url = target
    }

    // -- menus ----------------------------------------------------------------

    private fun showShield() {
        val message = getString(R.string.blocked_here, Blocker.pageBlocked()) + "\n" +
            getString(R.string.blocked_total, Blocker.sessionBlocked())
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    private fun showMenu() {
        val popup = PopupMenu(this, binding.menu)
        val menu = popup.menu

        menu.add(0, 1, 0, R.string.desktop_site).apply {
            isCheckable = true
            isChecked = prefs.desktopSite
        }
        menu.add(0, 2, 1, R.string.share)
        menu.add(0, 3, 2, R.string.clear_data)
        menu.add(0, 4, 3, R.string.about)

        popup.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                1 -> {
                    prefs.desktopSite = !prefs.desktopSite
                    activeTab?.webView?.settings?.userAgentString = if (prefs.desktopSite) {
                        genericUserAgent.replace("Android 14; K", "X11; Linux x86_64").replace(" Mobile", "")
                    } else {
                        genericUserAgent
                    }
                    activeTab?.webView?.reload()
                }
                2 -> shareCurrent()
                3 -> clearEverything()
                4 -> load("https://github.com/stillemptyNOW/umbra-browser")
            }
            true
        }
        popup.show()
    }

    private fun shareCurrent() {
        val url = activeTab?.url ?: return
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, url)
        }
        startActivity(Intent.createChooser(intent, getString(R.string.share)))
    }

    private fun clearEverything() {
        CookieManager.getInstance().removeAllCookies(null)
        CookieManager.getInstance().flush()
        WebStorage.getInstance().deleteAllData()
        for (tab in tabs) {
            tab.webView.clearCache(true)
            tab.webView.clearHistory()
            tab.webView.clearFormData()
        }
        Toast.makeText(this, R.string.cleared, Toast.LENGTH_SHORT).show()
    }

    override fun onDestroy() {
        if (prefs.clearOnExit && isFinishing) clearEverything()
        for (tab in tabs) tab.webView.destroy()
        tabs.clear()
        super.onDestroy()
    }

    companion object {
        private const val HOME = "https://duckduckgo.com/"
    }
}
