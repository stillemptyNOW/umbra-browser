import Foundation

/// Turning what someone typed into something to load.
enum Urls {

    static let searchTemplate = "https://duckduckgo.com/?q=%@"

    /// Query parameters that exist only to attribute a click to a campaign.
    private static let trackingParameters: Set<String> = [
        "gclid", "gclsrc", "dclid", "gbraid", "wbraid", "gad_source",
        "fbclid", "msclkid", "twclid", "ttclid", "igshid", "igsh", "yclid", "ysclid",
        "mc_cid", "mc_eid", "mkt_tok", "_openstat", "vero_id", "epik", "rdt_cid",
        "li_fat_id", "irclickid", "s_cid", "ref_src", "spm", "scm", "_ga", "_gl",
        "hsCtaTracking", "__hssc", "__hstc", "__hsfp",
    ]

    /// Anything that is not plausibly an address becomes a search. A typo
    /// should never turn into a DNS lookup somebody can watch.
    static func resolve(_ input: String) -> URL? {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }

        let lowered = text.lowercased()
        if lowered.hasPrefix("javascript:") || lowered.hasPrefix("data:") ||
            lowered.hasPrefix("file:") || lowered.hasPrefix("vbscript:") {
            return nil
        }

        if text.hasPrefix("http://") || text.hasPrefix("https://") || text.hasPrefix("about:") {
            return URL(string: text)
        }

        let looksLikeHost = !text.contains(" ") &&
            text.range(of: #"^[^\s/?#@]+\.[a-z]{2,63}(:\d{1,5})?([/?#]|$)"#,
                       options: [.regularExpression, .caseInsensitive]) != nil

        if looksLikeHost { return URL(string: "https://" + text) }

        let escaped = text.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? text
        return URL(string: String(format: searchTemplate, escaped))
    }

    static func strippingTrackingParameters(_ url: URL) -> URL {
        guard
            var components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            let items = components.queryItems,
            !items.isEmpty
        else { return url }

        let kept = items.filter { item in
            !(trackingParameters.contains(item.name) || item.name.hasPrefix("utm_"))
        }
        guard kept.count != items.count else { return url }

        components.queryItems = kept.isEmpty ? nil : kept
        return components.url ?? url
    }

    /// Address-bar text: no scheme noise, no bare trailing slash.
    static func pretty(_ url: URL?) -> String {
        guard let url, let host = url.host else { return "" }
        let path = url.path == "/" ? "" : url.path
        let query = url.query.map { "?\($0)" } ?? ""
        return url.scheme == "https" ? "\(host)\(path)\(query)" : "\(url.scheme ?? "")://\(host)\(path)\(query)"
    }

    static func isSecure(_ url: URL?) -> Bool {
        url?.scheme == "https"
    }
}
