import SwiftUI
import WebKit

/// Hosts whichever tab is active. Each tab owns its WKWebView for the whole of
/// its life, so switching tabs swaps a subview rather than reloading a page.
struct WebViewContainer: UIViewRepresentable {

    let tab: BrowserTab

    func makeUIView(context: Context) -> UIView {
        let host = UIView()
        host.backgroundColor = .black
        attach(tab.webView, to: host)
        return host
    }

    func updateUIView(_ host: UIView, context: Context) {
        guard tab.webView.superview !== host else { return }
        host.subviews.forEach { $0.removeFromSuperview() }
        attach(tab.webView, to: host)
    }

    private func attach(_ webView: WKWebView, to host: UIView) {
        webView.removeFromSuperview()
        webView.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: host.topAnchor),
            webView.bottomAnchor.constraint(equalTo: host.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: host.trailingAnchor),
        ])
    }
}
