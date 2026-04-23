import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Localize } from '@deriv-com/translations';
import './dcircles.scss';

// ─── Types ────────────────────────────────────────────────────────────────────

type TSymbol = {
    symbol: string;
    display_name: string;
};

type TActiveSymbolItem = {
    symbol: string;
    display_name?: string;
};

// ─── Request IDs ──────────────────────────────────────────────────────────────
// Only two calls are needed:
//   1) active_symbols  → get market list
//   2) ticks_history + subscribe:1  → history + live stream in ONE call
const REQ_ACTIVE_SYMBOLS = 1001;
const REQ_TICKS = 1002;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getLastDigit = (value: number | string): number => {
    // Remove the decimal point, then take the last character as the digit
    const s = String(value).replace('.', '');
    const d = Number(s[s.length - 1]);
    return Number.isFinite(d) ? d : 0;
};

/**
 * Volatile-index markets to show when the WS has not yet returned
 * active_symbols (e.g. still connecting) or cannot be reached.
 */
const FALLBACK_SYMBOLS: TSymbol[] = [
    { symbol: 'R_10', display_name: 'Volatility 10 Index' },
    { symbol: 'R_25', display_name: 'Volatility 25 Index' },
    { symbol: 'R_50', display_name: 'Volatility 50 Index' },
    { symbol: 'R_75', display_name: 'Volatility 75 Index' },
    { symbol: 'R_100', display_name: 'Volatility 100 Index' },
    { symbol: '1HZ10V', display_name: 'Volatility 10 (1s) Index' },
    { symbol: '1HZ25V', display_name: 'Volatility 25 (1s) Index' },
    { symbol: '1HZ50V', display_name: 'Volatility 50 (1s) Index' },
    { symbol: '1HZ75V', display_name: 'Volatility 75 (1s) Index' },
    { symbol: '1HZ100V', display_name: 'Volatility 100 (1s) Index' },
];

/**
 * Generate a plausible-looking 1 000-tick distribution for offline preview
 * so the circles are never blank regardless of WS status.
 */
const buildSeedWindow = (): number[] => {
    // Slightly uneven weights so the preview looks realistic
    const weights = [0.11, 0.09, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10];
    const arr: number[] = [];
    weights.forEach((w, digit) => {
        const n = Math.round(w * 1000);
        for (let i = 0; i < n; i++) arr.push(digit);
    });
    while (arr.length < 1000) arr.push(Math.floor(Math.random() * 10));
    // Shuffle so it doesn't look sorted
    return arr.slice(0, 1000).sort(() => Math.random() - 0.5);
};

// ─── Component ────────────────────────────────────────────────────────────────

const DCircles = observer(() => {
    const wsRef = useRef<WebSocket | null>(null);
    /** Subscription ID returned by ticks_history+subscribe — used with `forget` */
    const subIdRef = useRef<string | null>(null);
    const selectedSymbolRef = useRef<string>('R_10');

    const [symbols, setSymbols] = useState<TSymbol[]>(FALLBACK_SYMBOLS);
    const [selectedSymbol, setSelectedSymbol] = useState('R_10');
    /**
     * Seed with offline data immediately so circles are visible from the start.
     * Real tick history will overwrite this as soon as the WS handshake completes.
     */
    const [digitsWindow, setDigitsWindow] = useState<number[]>(buildSeedWindow);
    const [isLiveLoading, setIsLiveLoading] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<
        'connecting' | 'connected' | 'closed' | 'error'
    >('connecting');

    // Keep the ref in sync so callbacks never capture stale closure values
    selectedSymbolRef.current = selectedSymbol;

    // ── Low-level send ────────────────────────────────────────────────────────
    const send = useCallback((payload: Record<string, unknown>) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(payload));
        }
    }, []);

    // ── Subscribe to a symbol ─────────────────────────────────────────────────
    /**
     * Single ticks_history call with subscribe:1.
     *
     * Per the official schema (additionalProperties:false) the valid fields are:
     *   ticks_history (required), end (required), count, style, subscribe, req_id
     *
     * The server responds with:
     *   msg_type:"history"  → contains history.prices[]  AND subscription.id
     *   msg_type:"tick"     → every subsequent live tick
     */
    const subscribeToSymbol = useCallback(
        (symbol: string) => {
            if (!symbol) return;

            // Forget any existing subscription before starting a new one
            if (subIdRef.current) {
                send({ forget: subIdRef.current });
                subIdRef.current = null;
            }

            setIsLiveLoading(true);

            send({
                ticks_history: symbol,   // required — short symbol name
                end: 'latest',           // required — latest available timestamp
                count: 1000,             // optional — up to 1 000 historical ticks
                style: 'ticks',          // optional — return raw ticks (not candles)
                subscribe: 1,            // optional — keep stream open after history
                req_id: REQ_TICKS,
            });
        },
        [send]
    );

    // ── WebSocket lifecycle ───────────────────────────────────────────────────
    useEffect(() => {
        // Public read-only endpoint — no authentication required
        const ws = new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');
        wsRef.current = ws;

        ws.onopen = () => {
            setConnectionStatus('connected');
            // Schema: active_symbols (required:"full"|"brief"), req_id (optional:integer)
            send({
                active_symbols: 'brief',
                req_id: REQ_ACTIVE_SYMBOLS,
            });
        };

        ws.onmessage = event => {
            try {
                const msg = JSON.parse(event.data as string);
                const { msg_type, req_id, error } = msg;

                // ── Server-side errors ──────────────────────────────────────
                if (error) {
                    console.error('[DCircles] Server error:', error.message, msg);
                    setIsLiveLoading(false);
                    return;
                }

                // ── active_symbols response ─────────────────────────────────
                if (msg_type === 'active_symbols' && req_id === REQ_ACTIVE_SYMBOLS) {
                    const raw: TActiveSymbolItem[] = msg.active_symbols ?? [];

                    // Keep only volatility indices (R_xx and 1HZxxV)
                    const volatile = raw.filter(
                        item => typeof item.symbol === 'string' && /^(R_\d|1HZ\d)/.test(item.symbol)
                    );

                    const fetched: TSymbol[] =
                        volatile.length > 0
                            ? volatile
                                  .map(item => ({
                                      symbol: item.symbol,
                                      display_name: item.display_name ?? item.symbol,
                                  }))
                                  .sort((a, b) => a.display_name.localeCompare(b.display_name))
                            : FALLBACK_SYMBOLS;

                    setSymbols(fetched);

                    // Pick the currently-selected symbol if still available,
                    // otherwise fall back to R_10, otherwise first in list
                    const target =
                        fetched.find(s => s.symbol === selectedSymbolRef.current)?.symbol ??
                        fetched.find(s => s.symbol === 'R_10')?.symbol ??
                        fetched[0]?.symbol;

                    if (target) {
                        selectedSymbolRef.current = target;
                        setSelectedSymbol(target);
                        subscribeToSymbol(target);
                    }
                }

                // ── ticks_history response ──────────────────────────────────
                // msg_type:"history" fires once with the historical batch.
                // The `subscription` object (if present) holds the stream ID.
                if (msg_type === 'history' && req_id === REQ_TICKS) {
                    // Capture the subscription ID so we can forget it later
                    if (msg.subscription?.id) {
                        subIdRef.current = msg.subscription.id;
                    }

                    const prices: (number | string)[] = msg.history?.prices ?? [];
                    if (prices.length > 0) {
                        setDigitsWindow(prices.map(p => getLastDigit(p)).slice(-1000));
                    }
                    setIsLiveLoading(false);
                }

                // ── live tick stream ────────────────────────────────────────
                // msg_type:"tick" fires for every new tick after history is sent.
                if (msg_type === 'tick') {
                    // Subscription ID may also arrive on the first tick message
                    if (!subIdRef.current && msg.tick?.subscription?.id) {
                        subIdRef.current = msg.tick.subscription.id;
                    }
                    const quote = msg.tick?.quote;
                    if (quote !== undefined) {
                        setDigitsWindow(prev => [...prev.slice(-999), getLastDigit(quote)]);
                    }
                }
            } catch (err) {
                console.error('[DCircles] Failed to parse WS message:', err);
            }
        };

        ws.onerror = () => {
            setConnectionStatus('error');
            setIsLiveLoading(false); // always show circles even on error
        };

        ws.onclose = () => {
            setConnectionStatus('closed');
            setIsLiveLoading(false); // always show circles even when closed
        };

        return () => {
            // Clean up: forget the stream, then close the socket
            if (subIdRef.current && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ forget: subIdRef.current }));
            }
            ws.close();
            wsRef.current = null;
            subIdRef.current = null;
        };
    }, [send, subscribeToSymbol]);

    // ── Symbol change handler ─────────────────────────────────────────────────
    const handleSymbolChange = (symbol: string) => {
        if (!symbol || symbol === selectedSymbolRef.current) return;
        selectedSymbolRef.current = symbol;
        setSelectedSymbol(symbol);
        // Keep old digit data visible while new history loads
        subscribeToSymbol(symbol);
    };

    // ── Digit statistics ──────────────────────────────────────────────────────
    const digitStats = useMemo(() => {
        const counts = Array.from({ length: 10 }, (_, d) => ({ digit: d, count: 0, percentage: 0 }));
        if (!digitsWindow.length) return counts;

        for (const d of digitsWindow) {
            if (counts[d]) counts[d].count++;
        }

        return counts.map(item => ({
            ...item,
            percentage: Number(((item.count / digitsWindow.length) * 100).toFixed(2)),
        }));
    }, [digitsWindow]);

    const isOffline = connectionStatus === 'closed' || connectionStatus === 'error';

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className='dcircles-page'>
            {/* Header */}
            <div className='dcircles-page__header'>
                <div>
                    <h2>
                        <Localize i18n_default_text='DCircles Digit Analysis' />
                    </h2>
                    <p>
                        <Localize i18n_default_text='Last 1000 ticks distribution (0–9) with realtime updates' />
                    </p>
                </div>
                <div className={`dcircles-page__status dcircles-page__status--${connectionStatus}`}>
                    {connectionStatus}
                </div>
            </div>

            {/* Offline notice */}
            {isOffline && (
                <div className='dcircles-page__offline-banner'>
                    <Localize i18n_default_text='Live data unavailable — showing cached digit distribution.' />
                </div>
            )}

            {/* Symbol picker */}
            <div className='dcircles-page__controls'>
                <label htmlFor='dcircles-symbol'>
                    <Localize i18n_default_text='Market symbol' />
                </label>
                <select
                    id='dcircles-symbol'
                    value={selectedSymbol}
                    onChange={e => handleSymbolChange(e.target.value)}
                >
                    {symbols.map(s => (
                        <option key={s.symbol} value={s.symbol}>
                            {s.display_name}
                        </option>
                    ))}
                </select>

                {/* Inline loading indicator — shown while new history is arriving */}
                {isLiveLoading && <span className='dcircles-page__spinner' title='Loading ticks…' />}
            </div>

            {/* Digit circles — always rendered */}
            <div className='dcircles-grid'>
                {digitStats.map(({ digit, count, percentage }) => (
                    <div key={digit} className='dcircles-card'>
                        <div className='dcircles-card__digit'>{digit}</div>
                        <div className='dcircles-card__meta'>
                            <span>{percentage}%</span>
                            <span>{count} ticks</span>
                        </div>
                        <div className='dcircles-card__bar'>
                            <div
                                className='dcircles-card__bar-fill'
                                style={{ width: `${percentage}%` }}
                            />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
});

export default DCircles;
