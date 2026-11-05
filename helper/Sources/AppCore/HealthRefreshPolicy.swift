import Foundation

/// When the control panel re-checks the setup by itself. Pure logic, so it can be tested without a window, a clock or Cheetah3D.
///
/// Why it exists: the first health check runs when the app starts, usually BEFORE the user has started Cheetah3D, so it reports
/// "Cheetah3D is not running". Nothing used to refresh it afterwards, so the page stayed red although everything was fine.
public struct HealthRefreshPolicy: Sendable, Equatable {
    /// Minimum time between two automatic checks caused by the window coming to the front.
    public var activationThrottle: TimeInterval
    /// Waits before the automatic runs that follow a Cheetah3D launch (4 s, then 8 s more, then 18 s more: 4, 12 and 30 s after the launch).
    /// Its menu bar takes a moment to build, so the first run may still see no bridge menu item.
    public var launchGaps: [TimeInterval]

    public init(activationThrottle: TimeInterval = 5, launchGaps: [TimeInterval] = [4, 8, 18]) {
        self.activationThrottle = activationThrottle
        self.launchGaps = launchGaps
    }

    /// Should the window coming to the front start a check?
    public func shouldCheckOnActivation(lastChecked: Date?, now: Date, busy: Bool) -> Bool {
        if busy { return false }
        guard let last = lastChecked else { return true }
        return now.timeIntervalSince(last) >= activationThrottle
    }

    /// How long to wait before automatic run number `run` (0-based) after a Cheetah3D launch; nil when no more runs are wanted.
    /// The first run always happens; later ones only while the previous result was not healthy.
    public func gapBeforeLaunchRun(_ run: Int, previousHealthy: Bool?) -> TimeInterval? {
        guard launchGaps.indices.contains(run) else { return nil }
        if run == 0 { return launchGaps[0] }
        return previousHealthy == true ? nil : launchGaps[run]
    }
}
