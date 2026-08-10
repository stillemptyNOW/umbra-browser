import SwiftUI

@main
struct UmbraApp: App {

    @StateObject private var model = BrowserModel()

    var body: some Scene {
        WindowGroup {
            BrowserView()
                .environmentObject(model)
                .preferredColorScheme(.dark)
                .onOpenURL { url in model.newTab(url) }
        }
    }
}
