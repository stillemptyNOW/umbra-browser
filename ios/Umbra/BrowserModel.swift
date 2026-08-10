import Foundation
import WebKit
import Combine
import UIKit

/// One tab: a live WKWebView plus the bits of state the UI binds to.
@MainActor
final class BrowserTab: NSObject, ObservableObject, Identifiable {
    let id = UUID()
    let webView: WKWebView

    @Published var title: String = ""
    @Published var url: URL?
    @Published var isLoading = false
    @Published var progress: Double = 0
    @Published var canGoBack = false
    @Published var canGoForward = false

    private var observers: [NSKeyValueObservation] = []

    init(configuration: WKWebViewConfiguration) {
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()

        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = .black
        // Announcing Umbra would be a near-unique signal; look like Safari.
        webView.customUserAgent = nil

        observers = [
            webView.observe(\.title, options: [.new]) { [weak self] view, _ in
                Task { @MainActor in self?.title = view.title ?? "" }
            },
            webView.observe(\.url, options: [.new]) { [weak self] view, _ in
                Task { @MainActor in self?.url = view.url }
            },
            webView.observe(\.isLoading, options: [.new]) { [weak self] view, _ in
                Task { @MainActor in self?.isLoading = view.isLoading }
            },
            webView.observe(\.estimatedProgress, options: [.new]) { [weak self] view, _ in
                Task { @MainActor in self?.progress = view.estimatedProgress }
            },
            webView.observe(\.canGoBack, options: [.new]) { [weak self] view, _ in
                Task { @MainActor in self?.canGoBack = view.canGoBack }
            },
            webView.observe(\.canGoForward, options: [.new]) { [weak self] view, _ in
                Task { @MainActor in self?.canGoForward = view.canGoForward }
            },
        ]
    }

    func load(_ url: URL) {
        webView.load(URLRequest(url: url))
    }
}

@MainActor
final class BrowserModel: NSObject, ObservableObject {

    @Published private(set) var tabs: [BrowserTab] = []
    @Published var currentIndex = 0
    @Published var addressText = ""
    @Published var isEditingAddress = false
    @Published var showTabs = false
    @Published var blockingReady = false
    @Published var isPrivate = false

    private var ruleList: WKContentRuleList?
    private let startScript: WKUserScript?

    var current: BrowserTab? { tabs.indices.contains(currentIndex) ? tabs[currentIndex] : nil }

    static let home = URL(string: "https://duckduckgo.com/")!

    override init() {
        startScript = Self.makeStartScript()
        super.init()
        newTab(Self.home)
    }

    // MARK: - configuration

    /// Per-install random, mixed with the hostname, seeds the fingerprinting
    /// defence: stable per site, never the same across two sites.
    private static func installSeed() -> String {
        let key = "io.umbra.installSeed"
        if let existing = UserDefaults.standard.string(forKey: key) { return existing }
        let generated = UUID().uuidString
        UserDefaults.standard.set(generated, forKey: key)
        return generated
    }

    private static func makeStartScript() -> WKUserScript? {
        guard
            let url = Bundle.main.url(forResource: "farble", withExtension: "js"),
            let source = try? String(contentsOf: url, encoding: .utf8)
        else { return nil }

        return WKUserScript(
            source: source.replacingOccurrences(of: "__UMBRA_SECRET__", with: installSeed()),
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        )
    }

    private func makeConfiguration() -> WKWebViewConfiguration {
        let configuration = WKWebViewConfiguration()

        configuration.websiteDataStore = isPrivate ? .nonPersistent() : .default()
        configuration.upgradeKnownHostsToHTTPS = true
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        if let startScript {
            configuration.userContentController.addUserScript(startScript)
        }
        if let ruleList {
            configuration.userContentController.add(ruleList)
        }
        return configuration
    }

    func startBlocking() async {
        ruleList = await ContentBlocker.load()
        blockingReady = ruleList != nil

        guard let ruleList else { return }
        for tab in tabs {
            tab.webView.configuration.userContentController.add(ruleList)
        }
    }

    // MARK: - tabs

    func newTab(_ url: URL = BrowserModel.home) {
        let tab = BrowserTab(configuration: makeConfiguration())
        tab.webView.navigationDelegate = self
        tabs.append(tab)
        currentIndex = tabs.count - 1
        tab.load(url)
        showTabs = false
    }

    func closeTab(_ tab: BrowserTab) {
        guard let index = tabs.firstIndex(where: { $0.id == tab.id }) else { return }
        tab.webView.stopLoading()
        tabs.remove(at: index)

        if tabs.isEmpty {
            newTab()
        } else {
            currentIndex = min(index, tabs.count - 1)
        }
    }

    func select(_ tab: BrowserTab) {
        guard let index = tabs.firstIndex(where: { $0.id == tab.id }) else { return }
        currentIndex = index
        showTabs = false
    }

    // MARK: - navigation

    func submitAddress() {
        guard let url = Urls.resolve(addressText) else { return }
        current?.load(url)
        isEditingAddress = false
    }

    func goBack() { current?.webView.goBack() }
    func goForward() { current?.webView.goForward() }
    func reload() { current?.webView.reload() }

    func clearEverything() async {
        let types = WKWebsiteDataStore.allWebsiteDataTypes()
        await WKWebsiteDataStore.default().removeData(ofTypes: types, modifiedSince: .distantPast)
        HTTPCookieStorage.shared.removeCookies(since: .distantPast)
    }

    func syncAddress() {
        guard !isEditingAddress else { return }
        addressText = Urls.pretty(current?.url)
    }
}

extension BrowserModel: WKNavigationDelegate {

    nonisolated func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        // Anything that is not the web goes to the system, never to a tab.
        if let scheme = url.scheme, scheme != "http", scheme != "https", scheme != "about" {
            Task { @MainActor in
                if UIApplication.shared.canOpenURL(url) { UIApplication.shared.open(url) }
            }
            decisionHandler(.cancel)
            return
        }

        let cleaned = Urls.strippingTrackingParameters(url)
        if cleaned != url {
            decisionHandler(.cancel)
            Task { @MainActor in webView.load(URLRequest(url: cleaned)) }
            return
        }

        decisionHandler(.allow)
    }

    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor in syncAddress() }
    }
}
