# TypeScript Error Remediation Plan (Current Branch)

> Note: In this environment only the `work` branch exists (no `master` branch is available locally), so remediation is based on current `work` state.

## Current status
Running `npm run type-check` currently reports a large number of pre-existing errors across multiple domains (Blockly typings, shared UI prop types, legacy helper utilities, and unresolved alias imports).

## Practical stabilization strategy
1. **Runtime-critical path first (done in this patch series)**
   - WebSocket contract-close lifecycle
   - Realtime balance synchronization
   - Active symbols bootstrap/retry resilience

2. **Typecheck hardening in focused batches**
   - Batch A: `src/stores/*` missing module aliases/types
   - Batch B: `src/components/flyout/*` Blockly workspace typings
   - Batch C: `src/components/run-panel/*` and shared UI prop contracts
   - Batch D: `src/utils/tmp/*` legacy utilities (migrate or exclude from strict compile)

3. **Definition of done for “smooth forever”**
   - `npm run type-check` clean
   - `npm run build` clean
   - WS smoke test for 30+ continuous contracts with no stuck pending state
   - balance stream monotonic correctness against WS `balance` payloads

## Immediate improvements added
- Added retry + backoff for `active_symbols` fetch (3 attempts).
- Reject empty `active_symbols` responses as failures (instead of caching empty state).
- Reset active symbol state on failure to avoid stale-loop deadlocks.
