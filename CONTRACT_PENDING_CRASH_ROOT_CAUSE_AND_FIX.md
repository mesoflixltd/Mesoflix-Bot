# Contract Stuck as Pending + Crash on Bot Restart: Root Cause & Complete Fix

## Reported symptoms
1. A contract opens, but it is never marked as closed in the UI and appears to stay pending.
2. After stopping and starting the bot, the site crashes with:
   - `TypeError: Cannot read properties of undefined (reading 'buy')`
   - stack pointing to transaction `keyMapper`.

## Exact root cause
The `APIBase` message bridge was forwarding **non-contract payloads** (`balance`, `transaction`) into the `bot.contract` event channel.

- `bot.contract` is consumed by stores/components that assume the payload is a **contract-like object** with `transaction_ids.buy`.
- When `balance` or `transaction` messages were injected there, those consumers attempted to read `transaction_ids.buy` from incompatible payloads, causing runtime errors.
- Once this bad state reached transaction rendering, React crashed in row key mapping (`row.data.transaction_ids.buy` access).

## Why this also causes "pending" behavior
When the transaction stream/UI crashes during active updates:
- the run panel and transaction timeline can stop reflecting subsequent `proposal_open_contract` updates,
- so the contract may appear stuck as pending even when backend events continue.

## Implemented fix (v1)
### 1) Stop polluting `bot.contract` with non-contract data
In `src/external/bot-skeleton/services/api/api-base.ts`:
- Keep `bot.contract` emission only for `proposal_open_contract`.
- Remove emission of `balance` and `transaction` over `bot.contract`.

This restores event-channel correctness:
- `bot.contract` => contract payloads only.
- `contract.status` continues to drive stage transitions (`purchase_received`, `sold`).

### 2) Add defensive guard in transaction store
In `src/stores/transactions-store.ts`:
- Ignore incoming `bot.contract` payloads that do not contain `transaction_ids.buy`.

This prevents malformed data from entering transaction state even if introduced by future regressions.

### 3) Add defensive key mapping in transaction list rendering
In `src/components/transactions/transactions.tsx`:
- Use safe optional chaining/fallback in `keyMapper` to avoid hard crash if a malformed row appears.

## Branch/commit investigation result
Checked branch and commit history for an existing fix specifically addressing this crash/pending behavior.

### Commands used
- `git branch -a`
- `git log --oneline --decorate --graph --all --max-count=80`

### Finding
- Only one local branch is available in this environment: `work`.
- No separate branch or explicit latest commit message was found that clearly and specifically fixes this exact `transaction_ids.buy` crash caused by `bot.contract` payload contamination.
- Therefore, the above fix set was implemented as the resolution.

## Validation checklist (recommended)
1. Start bot and open contract.
2. Confirm transaction row renders without console TypeError.
3. Wait for contract closure and verify status transitions to closed.
4. Stop bot, start bot again, and verify app does not crash.
5. Confirm no malformed payloads are entering `bot.contract` in logs.

## Additional hardening recommendation
If desired, introduce strict runtime type guards for observer channels (e.g., `isProposalOpenContractPayload`) so contracts, balances, and transactions are routed by schema rather than `msg_type` alone.

---

## Follow-up deep-dive (v2): why contracts still appeared stuck + balance looked stale

After the first fix, two additional root causes remained:

1. **Contract close detection was too narrow in API event routing**
   - The status bridge only treated `proposal_open_contract.is_sold` as a closed signal.
   - Many closed contracts are represented by other fields (`status !== 'open'`, `is_expired`, `is_settleable`).
   - Result: UI state machine could remain in purchase/pending path and block continuous trading.

2. **Balance subscription data was not being applied to client state**
   - `balance` stream was subscribed, but updates were not written back into app state.
   - Result: UI showed decreasing/old balances and appeared not to refresh after winning contracts.

3. **Active-symbol cache needed explicit reset on fresh socket instances**
   - On new/recreated connections, stale symbol flags/promises can prevent a clean re-bootstrap.
   - Result: repeated `No symbols found, attempting fresh fetch...` loops and bot waiting on market discovery.

## Implemented fix (v2)

### A) Correctly detect closed contracts from proposal updates
- Added robust close detection using:
  - `is_sold`
  - `is_expired`
  - `is_settleable`
  - `status && status !== 'open'`
- This ensures `contract.status` emits `contract.sold` whenever the contract is actually closed.

### B) Wire live balance stream updates into app state
- On `msg_type === 'balance'`:
  - update observable auth/account list state (`setAccountList`, `setAuthData`)
  - update active `client.store` balance/currency (`setBalance`, `setCurrency`)
- This keeps balance in sync in realtime after both wins and losses.

### C) Reset symbol state on new socket instances
- On connection recreation:
  - clear `has_active_symbols`
  - clear cached `active_symbols`
  - clear `active_symbols_promise`
- This forces clean symbol re-fetch after reconnect/account regeneration and avoids stale cache loops.

### D) Prevent concurrent socket init races and OAuth hard-fail on transient WS errors
- Serialize `APIBase.init()` calls (including forced reconnect calls) so only one init pipeline can run at a time.
- Queue force-reinit requests instead of opening competing sockets in parallel.
- Avoid rethrowing raw WebSocket `error` events from `init()`; emit error + closed status and let reconnect logic recover.
- This prevents:
  - double `Requesting new API instance...` races,
  - singleton clears while another socket is mid-handshake,
  - OAuth/account-fetch flows failing hard due to transient WS errors.

### E) Fix market-selection connection path in Active Symbols cache
- `ActiveSymbols.retrieveActiveSymbols()` now bypasses stale cache when previous initialization failed.
- Promise failures from `api_base.active_symbols_promise` are handled and retried with forced refetch.
- `has_initialization_error` now resets correctly after successful fetches.
- Market open/close updates now map by symbol values instead of array index lookup, so selected market/symbol state stays aligned with incoming trading-time updates.
