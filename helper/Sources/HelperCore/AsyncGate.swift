/// Serialises focus-changing AX sequences across concurrent connections.
actor AsyncGate {
    private var locked = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func acquire() async {
        if locked {
            await withCheckedContinuation { waiters.append($0) }
        } else {
            locked = true
        }
    }

    func release() {
        if waiters.isEmpty { locked = false } else { waiters.removeFirst().resume() }
    }
}
