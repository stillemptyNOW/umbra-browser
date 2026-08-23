package io.umbra.browser

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.FrameLayout
import android.widget.PopupMenu
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import io.umbra.browser.databinding.ActivityMainBinding
import org.mozilla.geckoview.AllowOrDeny
import org.mozilla.geckoview.ContentBlocking
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSessionSettings
import org.mozilla.geckoview.GeckoView
import org.mozilla.geckoview.WebRequestError

class Tab(val session: GeckoSession) {
    var title: String = ""
    var url: String = ""
    var canGoBack: Boolean = false
    var canGoForward: Boolean = false
}

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var prefs: Prefs
    private lateinit var geckoView: GeckoView

    private val tabs = mutableListOf<Tab>()
    private var current = -1

    private val activeTab: Tab? get() = tabs.getOrNull(current)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        prefs = Prefs(this)
        geckoView = GeckoView(this)
        binding.webContainer.addView(
            geckoView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )

        wireChrome()

        val initial = intent?.dataString ?: HOME
        newTab(initial)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    binding.tabSheet.isVisible() -> showTabSheet(false)
                    activeTab?.canGoBack == true -> activeTab?.session?.goBack()
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

    private fun wireChrome() {
        binding.back.setOnClickListener { activeTab?.session?.goBack() }
        binding.forward.setOnClickListener { activeTab?.session?.goForward() }
        binding.reload.setOnClickListener { activeTab?.session?.reload() }
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
        binding.back.isEnabled = tab?.canGoBack == true
        binding.forward.isEnabled = tab?.canGoForward == true
        binding.back.alpha = if (binding.back.isEnabled) 1f else 0.3f
        binding.forward.alpha = if (binding.forward.isEnabled) 1f else 0.3f
        binding.tabCount.text = tabs.size.toString()

        val blocked = Blocker.pageBlocked()
        binding.blockCount.text = if (blocked > 0) blocked.toString() else ""
    }

    private fun attachDelegates(tab: Tab) {
        val session = tab.session

        session.navigationDelegate = object : GeckoSession.NavigationDelegate {
            override fun onLocationChange(
                session: GeckoSession,
                url: String?,
                perms: MutableList<GeckoSession.PermissionDelegate.ContentPermission>,
                hasUserGesture: Boolean,
            ) {
                tab.url = url.orEmpty()
                runOnUiThread { refreshChrome() }
            }

            override fun onCanGoBack(session: GeckoSession, canGoBack: Boolean) {
                tab.canGoBack = canGoBack
                runOnUiThread { refreshChrome() }
            }

            override fun onCanGoForward(session: GeckoSession, canGoForward: Boolean) {
                tab.canGoForward = canGoForward
                runOnUiThread { refreshChrome() }
            }

            override fun onLoadRequest(
                session: GeckoSession,
                request: GeckoSession.NavigationDelegate.LoadRequest,
            ): GeckoResult<AllowOrDeny> {
                val uri = Uri.parse(request.uri)
                val scheme = uri.scheme?.lowercase().orEmpty()
                if (scheme == "mailto" || scheme == "tel" || scheme == "sms") {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                    return GeckoResult.fromValue(AllowOrDeny.DENY)
                }
                if (scheme.isNotEmpty() && scheme != "http" && scheme != "https" &&
                    scheme != "about" && scheme != "blob"
                ) {
                    return GeckoResult.fromValue(AllowOrDeny.DENY)
                }
                val raw = request.uri
                val cleaned = if (prefs.httpsOnly) Blocker.cleanUrl(raw) else raw
                if (cleaned != raw && request.isRedirect.not()) {
                    session.loadUri(cleaned)
                    return GeckoResult.fromValue(AllowOrDeny.DENY)
                }
                return GeckoResult.fromValue(AllowOrDeny.ALLOW)
            }

            override fun onNewSession(
                session: GeckoSession,
                uri: String,
            ): GeckoResult<GeckoSession> {
                val created = openTab(uri, load = false)
                return GeckoResult.fromValue(created.session)
            }

            override fun onLoadError(
                session: GeckoSession,
                uri: String?,
                error: WebRequestError,
            ): GeckoResult<String>? = null
        }

        session.progressDelegate = object : GeckoSession.ProgressDelegate {
            override fun onPageStart(session: GeckoSession, url: String) {
                Blocker.resetPage()
                tab.url = url
                runOnUiThread {
                    binding.progress.visibility = View.VISIBLE
                    refreshChrome()
                }
            }

            override fun onPageStop(session: GeckoSession, success: Boolean) {
                runOnUiThread {
                    binding.progress.visibility = View.GONE
                    refreshChrome()
                }
            }

            override fun onProgressChange(session: GeckoSession, progress: Int) {
                runOnUiThread {
                    binding.progress.progress = progress
                    if (progress >= 100) binding.progress.visibility = View.GONE
                }
            }
        }

        session.contentDelegate = object : GeckoSession.ContentDelegate {
            override fun onTitleChange(session: GeckoSession, title: String?) {
                tab.title = title.orEmpty()
                runOnUiThread { binding.tabList.adapter?.notifyDataSetChanged() }
            }

            override fun onCrash(session: GeckoSession) {
                session.open(Engine.runtime(application))
                if (tab.url.isNotEmpty()) session.loadUri(tab.url)
            }

            override fun onKill(session: GeckoSession) {
                onCrash(session)
            }
        }

        session.contentBlockingDelegate = object : ContentBlocking.Delegate {
            override fun onContentBlocked(session: GeckoSession, event: ContentBlocking.BlockEvent) {
                Blocker.record()
                runOnUiThread { refreshChrome() }
            }
        }

        session.permissionDelegate = object : GeckoSession.PermissionDelegate {
            override fun onContentPermissionRequest(
                session: GeckoSession,
                perm: GeckoSession.PermissionDelegate.ContentPermission,
            ): GeckoResult<Int> {
                return GeckoResult.fromValue(GeckoSession.PermissionDelegate.ContentPermission.VALUE_DENY)
            }
        }
    }

    private fun openTab(url: String, load: Boolean = true): Tab {
        val session = Engine.newSession(desktop = prefs.desktopSite)
        session.open(Engine.runtime(application))
        val tab = Tab(session)
        attachDelegates(tab)
        tabs.add(tab)
        showTab(tabs.size - 1)
        if (load) load(url)
        return tab
    }

    private fun newTab(url: String) {
        openTab(url, load = true)
    }

    private fun showTab(index: Int) {
        val tab = tabs.getOrNull(index) ?: return
        current = index
        geckoView.setSession(tab.session)
        refreshChrome()
    }

    private fun closeTab(index: Int) {
        val tab = tabs.getOrNull(index) ?: return
        tabs.removeAt(index)
        if (geckoView.session === tab.session) geckoView.releaseSession()
        tab.session.close()

        if (tabs.isEmpty()) {
            newTab(HOME)
        } else {
            showTab(index.coerceAtMost(tabs.size - 1))
        }
        binding.tabList.adapter?.notifyDataSetChanged()
    }

    private fun load(url: String) {
        val target = if (prefs.httpsOnly) Blocker.cleanUrl(url) else url
        activeTab?.session?.loadUri(target)
        activeTab?.url = target
    }

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
                    activeTab?.session?.settings?.userAgentMode =
                        if (prefs.desktopSite) GeckoSessionSettings.USER_AGENT_MODE_DESKTOP
                        else GeckoSessionSettings.USER_AGENT_MODE_MOBILE
                    activeTab?.session?.settings?.viewportMode =
                        if (prefs.desktopSite) GeckoSessionSettings.VIEWPORT_MODE_DESKTOP
                        else GeckoSessionSettings.VIEWPORT_MODE_MOBILE
                    activeTab?.session?.reload()
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
        Engine.runtime(application).storageController.clearData(
            org.mozilla.geckoview.StorageController.ClearFlags.ALL
        )
        Toast.makeText(this, R.string.cleared, Toast.LENGTH_SHORT).show()
    }

    override fun onDestroy() {
        if (prefs.clearOnExit && isFinishing) clearEverything()
        geckoView.releaseSession()
        for (tab in tabs) tab.session.close()
        tabs.clear()
        super.onDestroy()
    }

    companion object {
        private const val HOME = "https://duckduckgo.com/"
    }
}
