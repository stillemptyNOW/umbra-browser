import SwiftUI

struct BrowserView: View {

    @EnvironmentObject private var model: BrowserModel
    @FocusState private var addressFocused: Bool
    @State private var showingShield = false

    var body: some View {
        VStack(spacing: 0) {
            addressBar
            progressBar

            ZStack {
                if let tab = model.current {
                    WebViewContainer(tab: tab)
                        .id(tab.id)
                }
                if model.showTabs {
                    tabSwitcher
                        .transition(.opacity)
                }
            }

            toolbar
        }
        .background(Theme.surface)
        .task { await model.startBlocking() }
        .onChange(of: model.currentIndex) { _ in model.syncAddress() }
        .onChange(of: model.current?.url) { _ in model.syncAddress() }
        .sheet(isPresented: $showingShield) { shieldSheet }
    }

    // MARK: - address bar

    private var addressBar: some View {
        HStack(spacing: 8) {
            Button { showingShield = true } label: {
                Image(systemName: model.blockingReady ? "shield.fill" : "shield.slash")
                    .foregroundStyle(model.blockingReady ? Theme.accentSoft : Theme.warn)
            }

            HStack(spacing: 8) {
                Image(systemName: Urls.isSecure(model.current?.url) ? "lock.fill" : "magnifyingglass")
                    .font(.system(size: 12))
                    .foregroundStyle(Urls.isSecure(model.current?.url) ? Theme.success : Theme.faint)

                TextField("Search or enter address", text: $model.addressText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.webSearch)
                    .submitLabel(.go)
                    .focused($addressFocused)
                    .foregroundStyle(Theme.text)
                    .onSubmit {
                        model.submitAddress()
                        addressFocused = false
                    }
                    .onChange(of: addressFocused) { focused in
                        model.isEditingAddress = focused
                        if !focused { model.syncAddress() }
                    }
            }
            .padding(.horizontal, 14)
            .frame(height: 40)
            .background(Theme.raised, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.border, lineWidth: 1))

            Button { model.reload() } label: {
                Image(systemName: model.current?.isLoading == true ? "xmark" : "arrow.clockwise")
                    .foregroundStyle(Theme.muted)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Theme.surface)
    }

    private var progressBar: some View {
        GeometryReader { geometry in
            let progress = model.current?.progress ?? 0
            let visible = model.current?.isLoading == true && progress < 1
            Rectangle()
                .fill(Theme.accent)
                .frame(width: geometry.size.width * progress)
                .opacity(visible ? 1 : 0)
                .animation(.easeOut(duration: 0.2), value: progress)
        }
        .frame(height: 2)
    }

    // MARK: - toolbar

    private var toolbar: some View {
        HStack {
            toolbarButton("chevron.left", enabled: model.current?.canGoBack == true) { model.goBack() }
            Spacer()
            toolbarButton("chevron.right", enabled: model.current?.canGoForward == true) { model.goForward() }
            Spacer()
            toolbarButton("plus") { model.newTab() }
            Spacer()

            Button {
                withAnimation(.easeOut(duration: 0.15)) { model.showTabs.toggle() }
            } label: {
                Text("\(model.tabs.count)")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.muted)
                    .frame(width: 24, height: 24)
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Theme.muted, lineWidth: 1.5))
            }

            Spacer()
            toolbarButton("ellipsis") { showingShield = true }
        }
        .padding(.horizontal, 28)
        .frame(height: 52)
        .background(Theme.surface)
    }

    private func toolbarButton(
        _ symbol: String,
        enabled: Bool = true,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 17))
                .foregroundStyle(enabled ? Theme.muted : Theme.faint.opacity(0.4))
        }
        .disabled(!enabled)
    }

    // MARK: - tab switcher

    private var tabSwitcher: some View {
        ScrollView {
            VStack(spacing: 8) {
                ForEach(model.tabs) { tab in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(tab.title.isEmpty ? "New tab" : tab.title)
                                .foregroundStyle(Theme.text)
                                .lineLimit(1)
                            Text(Urls.pretty(tab.url))
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.faint)
                                .lineLimit(1)
                        }
                        Spacer()
                        Button { model.closeTab(tab) } label: {
                            Image(systemName: "xmark").foregroundStyle(Theme.muted)
                        }
                    }
                    .padding(14)
                    .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
                    .onTapGesture { model.select(tab) }
                }
            }
            .padding(12)
        }
        .background(Theme.surface)
    }

    // MARK: - shield

    private var shieldSheet: some View {
        NavigationStack {
            List {
                Section("Protection") {
                    Label(
                        model.blockingReady
                            ? "Ad and tracker blocking is on"
                            : "Blocklist failed to compile",
                        systemImage: model.blockingReady ? "checkmark.shield.fill" : "exclamationmark.triangle"
                    )
                    Label("Cross-site cookies blocked", systemImage: "checkmark.shield.fill")
                    Label("Tracking parameters stripped", systemImage: "checkmark.shield.fill")
                    Label("Canvas, audio and WebGL randomised", systemImage: "checkmark.shield.fill")
                }

                Section {
                    Text(
                        "WebKit blocks these requests itself, below the JavaScript layer, "
                        + "which is why Umbra cannot show a per-page count on iOS. "
                        + "A number here would be a guess."
                    )
                    .font(.footnote)
                    .foregroundStyle(Theme.faint)
                }

                Section {
                    Button("Clear browsing data", role: .destructive) {
                        Task { await model.clearEverything() }
                    }
                }
            }
            .navigationTitle("Umbra")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium])
    }
}
