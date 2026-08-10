import Foundation
import WebKit

/// Compiles Umbra's blocklist into a `WKContentRuleList`.
///
/// On iOS this is the only real blocking mechanism available: WebKit refuses
/// third-party apps any request-interception hook, so rules have to be declared
/// up front and enforced by WebKit itself. The upside is that blocking happens
/// below the JavaScript layer and cannot be observed or defeated by a page. The
/// downside is that there is no callback, so Umbra cannot honestly report a
/// per-page blocked count on iOS — and does not pretend to.
enum ContentBlocker {

    private static let identifier = "io.umbra.blocklist"

    static func load() async -> WKContentRuleList? {
        let store = WKContentRuleListStore.default()

        // A compiled list is cached by WebKit between launches.
        if let cached = try? await store?.contentRuleList(forIdentifier: identifier) {
            return cached
        }

        guard
            let url = Bundle.main.url(forResource: "blocklist", withExtension: "json"),
            let json = try? String(contentsOf: url, encoding: .utf8)
        else {
            assertionFailure("blocklist.json missing from the bundle")
            return nil
        }

        return try? await store?.compileContentRuleList(
            forIdentifier: identifier,
            encodedContentRuleList: json
        )
    }

    /// Drop the compiled list so the next launch recompiles from the bundle.
    static func invalidate() async {
        try? await WKContentRuleListStore.default()?.removeContentRuleList(forIdentifier: identifier)
    }
}
