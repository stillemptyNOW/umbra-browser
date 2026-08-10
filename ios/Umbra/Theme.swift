import SwiftUI

/// The Umbra palette, sampled from the mark. Mirrors brand/tokens.json.
enum Theme {
    static let void_ = Color(hex: 0x04030A)
    static let surface = Color(hex: 0x0A0812)
    static let raised = Color(hex: 0x14101F)
    static let border = Color(hex: 0x2A2140)
    static let text = Color(hex: 0xEDEAF7)
    static let muted = Color(hex: 0x9A93B5)
    static let faint = Color(hex: 0x655D80)
    static let accent = Color(hex: 0x7726FA)
    static let accentSoft = Color(hex: 0xA78BFA)
    static let success = Color(hex: 0x3DD68C)
    static let warn = Color(hex: 0xF2B155)
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}
