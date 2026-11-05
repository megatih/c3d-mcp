import AppCore
import SwiftUI

enum Section: String, CaseIterable, Identifiable {
    case overview = "Overview", components = "Bridge", clients = "AI clients", permissions = "Permissions", activity = "Activity", cleanup = "Cleanup"
    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .overview: return "gauge.with.dots.needle.67percent"
        case .components: return "puzzlepiece.extension"
        case .clients: return "person.2.wave.2"
        case .permissions: return "lock.shield"
        case .activity: return "list.bullet.rectangle"
        case .cleanup: return "trash"
        }
    }
}

struct ContentView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var updates: UpdateController

    var body: some View {
        NavigationSplitView {
            // Each row needs an explicit .tag(s): List(data, selection:) would tag rows with their String `id`, which can never match
            // a Section? selection, so clicks would change nothing (the bug of 0.4.0; see SidebarTests).
            List(selection: $model.selectedSection) {
                ForEach(Section.allCases) { s in
                    Label(s.rawValue, systemImage: s.symbol)
                        .badge(s == .cleanup ? model.legacy.filter(\.removable).count : 0)
                        .tag(s)
                }
            }
            .navigationSplitViewColumnWidth(min: 170, ideal: 190)
        } detail: {
            VStack(spacing: 0) {
                if let b = model.banner { BannerView(banner: b) { model.banner = nil } }
                Group {
                    switch model.selectedSection ?? .overview {
                    case .overview: OverviewView(model: model, updates: updates)
                    case .components: ComponentsView(model: model)
                    case .clients: ClientsView(model: model)
                    case .permissions: PermissionsView(model: model)
                    case .activity: ActivityView(model: model)
                    case .cleanup: CleanupView(model: model)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
            .overlay(alignment: .bottomTrailing) {
                if let busy = model.busy {
                    HStack(spacing: 8) { ProgressView().controlSize(.small); Text(busy) }
                        .padding(10).background(.regularMaterial, in: Capsule()).padding(14)
                }
            }
        }
        .toolbar {
            ToolbarItem { Button { Task { await model.refresh() } } label: { Label("Refresh", systemImage: "arrow.clockwise") }.disabled(model.busy != nil) }
        }
        // A modal sheet would block Quit (and Sparkle's quit-and-install), so the offer lives in the Cleanup tab instead.
        .onChange(of: model.showMigration) { _, show in
            if show { model.selectedSection = .cleanup; model.showMigration = false }
        }
        // Let the first view update finish before refresh() starts publishing ("Publishing changes from within view updates").
        .task { await Task.yield(); await model.refresh() }
        .frame(minWidth: 760, minHeight: 500)
    }
}

struct BannerView: View {
    let banner: AppModel.Banner
    let close: () -> Void
    var body: some View {
        HStack(alignment: .top) {
            Image(systemName: banner.kind == .error ? "exclamationmark.triangle.fill" : banner.kind == .success ? "checkmark.circle.fill" : "info.circle.fill")
                .foregroundStyle(banner.kind == .error ? .red : banner.kind == .success ? .green : .blue)
            Text(banner.text).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
            Button(action: close) { Image(systemName: "xmark") }.buttonStyle(.plain)
        }
        .padding(10).background(.quaternary)
    }
}

struct Page<Content: View>: View {
    let title: String
    let subtitle: String
    @ViewBuilder var content: Content
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(title).font(.title.bold())
                Text(subtitle).foregroundStyle(.secondary)
                content
            }
            .padding(20).frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct StatusDot: View {
    let status: String
    var body: some View {
        Image(systemName: symbol).foregroundStyle(color).accessibilityLabel(status)
    }
    private var ok: Bool { ["ok", "current", "done", "unchanged"].contains(status) }
    private var warn: Bool { ["warn", "outdated", "missing", "skipped", "legacy"].contains(status) }
    private var symbol: String { ok ? "checkmark.circle.fill" : warn ? "exclamationmark.circle.fill" : "xmark.octagon.fill" }
    private var color: Color { ok ? .green : warn ? .orange : .red }
}

struct OverviewView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var updates: UpdateController
    var body: some View {
        Page(title: "C3D MCP", subtitle: "Let AI assistants build and render in Cheetah3D. This panel installs, connects and monitors everything.") {
            if let s = model.status {
                GroupBox("Bridge in Cheetah3D") {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(s.summary)
                        HStack {
                            if s.kind == "fresh" || s.recommended == "install" { Button("Install bridge") { Task { await model.installBridge() } }.buttonStyle(.borderedProminent) }
                            else if s.recommended == "update" { Button("Update bridge") { Task { await model.installBridge() } }.buttonStyle(.borderedProminent) }
                            else if s.recommended == "repair" { Button("Repair bridge") { Task { await model.installBridge(repair: true) } }.buttonStyle(.borderedProminent) }
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
                }
            }
            if let d = model.doctor {
                GroupBox("Health check — \(d.summary)") {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(d.checks.filter { $0.status != "ok" || d.checks.count < 6 }) { c in
                            HStack(alignment: .top) {
                                StatusDot(status: c.status)
                                VStack(alignment: .leading) {
                                    Text(c.name).bold()
                                    Text(c.detail).foregroundStyle(.secondary)
                                    if !c.fix.isEmpty { Text("→ " + c.fix) }
                                }
                            }
                        }
                        if d.ok { Label("Everything needed is working.", systemImage: "checkmark.seal.fill").foregroundStyle(.green) }
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
                }
            }
            GroupBox("This app") {
                HStack {
                    StatusDot(status: model.helperState == .running ? "ok" : model.helperState == .otherInstance ? "warn" : "fail")
                    switch model.helperState {
                    case .running: Text("The helper that presses Cheetah3D's menu is running inside this app.")
                    case .otherInstance: Text("Another copy of the helper is already running. If it is an older one, remove it in Cleanup.")
                    case .failed(let m): Text("The helper could not start: \(m)")
                    }
                }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
            }
            GroupBox("Updates") {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Version \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?")")
                        Text(updates.status).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Toggle("Check automatically", isOn: Binding(get: { updates.automatic }, set: { updates.setAutomatic($0) })).disabled(!updates.isAvailable)
                    Button("Check now") { updates.check() }.disabled(!updates.isAvailable)
                }.padding(4)
            }
            if !model.legacy.filter(\.removable).isEmpty {
                GroupBox("Earlier installation found") {
                    HStack {
                        Text("\(model.legacy.filter(\.removable).count) leftover item(s) from older versions can be removed.")
                        Spacer()
                        Button("Review…") { model.showMigration = true }
                    }.padding(4)
                }
            }
        }
    }
}

struct ComponentsView: View {
    @ObservedObject var model: AppModel
    @State private var confirmUninstall = false
    var body: some View {
        Page(title: "Bridge", subtitle: "The small macro inside Cheetah3D that receives requests, plus its mailbox folder.") {
            if let s = model.status {
                GroupBox {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(s.components) { c in
                            HStack(alignment: .top) {
                                StatusDot(status: c.status)
                                Text(c.name).bold().frame(width: 80, alignment: .leading)
                                Text(c.detail).foregroundStyle(.secondary).textSelection(.enabled)
                            }
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
                }
            }
            HStack {
                Button("Install or update") { Task { await model.installBridge() } }.buttonStyle(.borderedProminent)
                Button("Repair") { Task { await model.installBridge(repair: true) } }
                Button("Install agent skills") { Task { await model.installSkills(true) } }
                Button("Remove agent skills") { Task { await model.installSkills(false) } }
            }
            Text("After installing, restart Cheetah3D once: it only scans its macros at launch.").foregroundStyle(.secondary)
            Divider()
            Button("Uninstall everything…", role: .destructive) { confirmUninstall = true }
            Text("Removes the bridge, the agent skills and the c3d entries of your AI clients. Your Cheetah3D scripts and backups are kept. To remove this app afterwards, drag it to the Trash.").font(.callout).foregroundStyle(.secondary)
        }
        .confirmationDialog("Remove c3d-mcp from Cheetah3D, the agent skills and your AI clients?", isPresented: $confirmUninstall) {
            Button("Uninstall", role: .destructive) { Task { await model.uninstallEverything() } }
        }
    }
}

struct ClientsView: View {
    @ObservedObject var model: AppModel
    var body: some View {
        Page(title: "AI clients", subtitle: "Connect the assistants that should be able to use Cheetah3D. Restart a client after changing it.") {
            ForEach(model.clients) { row in
                GroupBox {
                    HStack {
                        VStack(alignment: .leading) {
                            Text(row.label).bold()
                            Text(stateText(row)).foregroundStyle(.secondary)
                        }
                        Spacer()
                        switch row.state {
                        case "current":
                            Button("Disconnect") { Task { await model.setClient(row, connected: false) } }
                        case "legacy":
                            Button("Switch to this app") { Task { await model.setClient(row, connected: true) } }.buttonStyle(.borderedProminent)
                        case "foreign":
                            Text("custom entry").foregroundStyle(.secondary)
                        default:
                            Button("Connect") { Task { await model.setClient(row, connected: true) } }.disabled(!row.detected || row.client == "lm-studio")
                        }
                    }.padding(4)
                }
            }
            if model.clients.isEmpty { Text("No client information yet. Press Refresh.").foregroundStyle(.secondary) }
        }
    }
    private func stateText(_ r: ClientRow) -> String {
        switch r.state {
        case "current": return "Connected through this app"
        case "legacy": return "Connected to an older install"
        case "foreign": return "A different \"c3d\" entry exists; left alone"
        default: return r.detected ? "Not connected" : "Not found on this Mac"
        }
    }
}

struct PermissionsView: View {
    @ObservedObject var model: AppModel
    var body: some View {
        Page(title: "Permissions", subtitle: "macOS permissions for this app, and how often c3d-mcp asks you to confirm things.") {
            GroupBox("macOS") {
                VStack(alignment: .leading, spacing: 10) {
                    permRow("Accessibility", "Lets the app press Cheetah3D's bridge menu item.", model.accessibility, "Grant…") { model.requestAccessibility() }
                    permRow("Screen Recording", "Only for viewport screenshots (optional).", model.screenRecording, "Grant…") { model.requestScreenRecording() }
                    Button("Re-check") { model.refreshPermissions() }
                    Text("macOS may ask you to quit and reopen the app after you switch a permission on.").font(.callout).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
            }
            GroupBox("Confirmation prompts") {
                VStack(alignment: .leading, spacing: 8) {
                    Picker("When c3d-mcp wants to overwrite a file, delete many objects or run a risky script", selection: Binding(get: { model.approval }, set: { model.setApproval($0) })) {
                        ForEach(ApprovalMode.allCases) { Text($0.title).tag($0) }
                    }.pickerStyle(.radioGroup)
                    Text(model.approval.explanation).font(.callout).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
            }
            GroupBox("Claude Code") {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Claude Code asks before every c3d tool call unless you allow them. This edits ~/.claude/settings.json (a backup is kept).")
                    HStack {
                        Button("Allow all c3d tools") { Task { await model.allowClaudeCode(true) } }
                        Button("Ask again") { Task { await model.allowClaudeCode(false) } }
                    }
                    Text("In Claude Desktop, choose “Always allow” on the first prompt of each tool.").font(.callout).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
            }
        }
    }
    private func permRow(_ name: String, _ why: String, _ granted: Bool, _ button: String, _ action: @escaping () -> Void) -> some View {
        HStack {
            StatusDot(status: granted ? "ok" : "warn")
            VStack(alignment: .leading) { Text(name).bold(); Text(why).foregroundStyle(.secondary) }
            Spacer()
            if !granted { Button(button, action: action) } else { Text("Granted").foregroundStyle(.green) }
        }
    }
}

struct ActivityView: View {
    @ObservedObject var model: AppModel
    var body: some View {
        Page(title: "Activity", subtitle: "What the helper has been doing, newest at the bottom.") {
            Text(model.logText).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading).padding(8).background(.quaternary, in: RoundedRectangle(cornerRadius: 6))
            HStack {
                Button("Reload") { model.reloadLog() }
                Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([model.helperLogURL]) }
            }
        }
    }
}

struct CleanupView: View {
    @ObservedObject var model: AppModel
    @State private var chosen: Set<String> = []
    var body: some View {
        Page(title: "Cleanup", subtitle: "Finds leftovers of every older way of installing c3d-mcp (install script, npm, npx, Homebrew, the Claude Desktop extension, the Claude Code plugin, hand copies). Removed files go to the Trash.") {
            FindingsList(model: model, chosen: $chosen)
            HStack {
                Button("Scan again") { Task { await model.refresh() } }
                Button("Remove selected") { Task { await model.removeLegacy(ids: Array(chosen)); chosen = [] } }
                    .buttonStyle(.borderedProminent).disabled(chosen.isEmpty)
            }
            if let r = model.lastReport { Text("Report: \(r)").font(.caption).textSelection(.enabled).foregroundStyle(.secondary) }
        }
        .onAppear { chosen = Set(model.legacy.filter(\.removable).map(\.id)) }
    }
}

struct FindingsList: View {
    @ObservedObject var model: AppModel
    @Binding var chosen: Set<String>
    var body: some View {
        if model.legacy.isEmpty {
            Label("No earlier installation found.", systemImage: "checkmark.seal.fill").foregroundStyle(.green)
        } else {
            ForEach(model.legacy) { f in
                GroupBox {
                    HStack(alignment: .top) {
                        if f.removable {
                            Toggle("", isOn: Binding(get: { chosen.contains(f.id) }, set: { if $0 { chosen.insert(f.id) } else { chosen.remove(f.id) } })).labelsHidden()
                        } else { Image(systemName: "info.circle").foregroundStyle(.secondary) }
                        VStack(alignment: .leading, spacing: 2) {
                            Text(f.label).bold()
                            Text("Installed by: \(f.installedBy)").font(.callout).foregroundStyle(.secondary)
                            Text(f.evidence).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                            if let q = f.needsQuit { Text("Needs \(q) closed. The app will quit it for you.").font(.caption).foregroundStyle(.orange) }
                            if !f.removable { Text("For your information only: remove it by hand if you want.").font(.caption) }
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
                }
            }
        }
    }
}
