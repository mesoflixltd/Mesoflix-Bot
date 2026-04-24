import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import './dcircles.scss';

// ─── Types ────────────────────────────────────────────────────────────────────
type TSymbol = { symbol: string; display_name: string };
type TActiveSymbolItem = { symbol: string; display_name?: string; pip?: number };
type THeat = 'hot' | 'warm' | 'neutral' | 'cold';

// ─── Constants ────────────────────────────────────────────────────────────────
const REQ_ACTIVE_SYMBOLS = 1001;
const REQ_TICKS          = 1002;
const WS_URL             = 'wss://api.derivws.com/trading/v1/options/ws/public';

const RING_R       = 38;
const RING_C       = 2 * Math.PI * RING_R;
const RING_MAX_PCT = 16;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getHeat = (pct: number): THeat => {
    if (pct >= 12.5) return 'hot';
    if (pct >= 10.5) return 'warm';
    if (pct >= 8.5)  return 'neutral';
    return 'cold';
};

// ─── Component ────────────────────────────────────────────────────────────────
const DCircles = observer(() => {
    const persisted    = typeof window !== 'undefined' ? localStorage.getItem('dcircles_selected_market') : null;
    const initialSymbol = persisted && persisted.length ? persisted : 'R_10';

    // Refs — survive re-renders without causing them
    const wsRef             = useRef<WebSocket | null>(null);
    const subIdRef          = useRef<string | null>(null);
    const selectedSymbolRef = useRef<string>(initialSymbol);
    const pipSizesRef       = useRef<Record<string, number>>({});
    const tickCountRef      = useRef<number>(1000);
    const flashTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isDestroyedRef    = useRef(false);

    // State
    const [symbols,        setSymbols]        = useState<TSymbol[]>([]);
    const [selectedSymbol, setSelectedSymbol] = useState<string>(initialSymbol);
    const [livePrice,      setLivePrice]      = useState<string | number>('—');
    const [digitsWindow,   setDigitsWindow]   = useState<number[]>([]);
    const [priceWindow,    setPriceWindow]    = useState<number[]>([]);
    const [liveLoading,    setLiveLoading]    = useState(true);
    const [lastDigit,      setLastDigit]      = useState<number | null>(null);
    const [tickInputVal,   setTickInputVal]   = useState<string>('1000');
    const [connStatus,     setConnStatus]     = useState<'connecting' | 'connected' | 'closed' | 'error'>('connecting');

    // ── Digit extraction ────────────────────────────────────────────────────
    const getDigit = useCallback((val: number | string): number => {
        const pip = pipSizesRef.current[selectedSymbolRef.current] ?? 2;
        const s   = Number(val).toFixed(pip);
        return Number(s[s.length - 1]);
    }, []);

    // ── Core WebSocket bootstrap ────────────────────────────────────────────
    const connect = useCallback(() => {
        if (isDestroyedRef.current) return;

        // Close existing socket if any
        if (wsRef.current) {
            try { wsRef.current.close(); } catch (_) { /* noop */ }
            wsRef.current = null;
        }

        setConnStatus('connecting');
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        // Helper that is always safe — checks readyState
        const safeSend = (payload: Record<string, unknown>) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(payload));
            }
        };

        const doSubscribe = (symbol: string) => {
            if (!symbol) return;
            if (subIdRef.current) {
                safeSend({ forget: subIdRef.current });
                subIdRef.current = null;
            }
            setLiveLoading(true);
            safeSend({
                ticks_history: symbol,
                end:           'latest',
                count:         tickCountRef.current,
                style:         'ticks',
                subscribe:     1,
                req_id:        REQ_TICKS,
            });
        };

        ws.onopen = () => {
            if (isDestroyedRef.current) { ws.close(); return; }
            setConnStatus('connected');
            safeSend({ active_symbols: 'brief', req_id: REQ_ACTIVE_SYMBOLS });
        };

        ws.onmessage = event => {
            try {
                const msg = JSON.parse(event.data as string);
                const { msg_type, req_id, error } = msg;

                if (error) {
                    console.warn('[DCircles] API error:', error.message);
                    setLiveLoading(false);
                    return;
                }

                // ── active_symbols ────────────────────────────────────────
                if (msg_type === 'active_symbols' && req_id === REQ_ACTIVE_SYMBOLS) {
                    const raw: TActiveSymbolItem[] = msg.active_symbols ?? [];
                    const volatile = raw.filter(
                        i => typeof i.symbol === 'string' && /^(R_\d|1HZ\d)/.test(i.symbol)
                    );
                    const fetched: TSymbol[] = volatile.map(i => ({
                        symbol:       i.symbol,
                        display_name: i.display_name ?? i.symbol,
                    }));

                    // Build pip map
                    const pips: Record<string, number> = {};
                    raw.forEach(s => {
                        if (s.symbol) {
                            pips[s.symbol] = s.pip ? Math.round(Math.abs(Math.log10(s.pip))) : 2;
                        }
                    });
                    pipSizesRef.current = pips;

                    const sorted = fetched.sort((a, b) => a.display_name.localeCompare(b.display_name));
                    setSymbols(sorted);

                    // Pick best target symbol
                    const target =
                        sorted.find(s => s.symbol === selectedSymbolRef.current)?.symbol ??
                        sorted.find(s => s.symbol === 'R_10')?.symbol ??
                        sorted[0]?.symbol;

                    if (target) {
                        selectedSymbolRef.current = target;
                        setSelectedSymbol(target);
                        doSubscribe(target);
                    }
                }

                // ── history ───────────────────────────────────────────────
                if (msg_type === 'history' && req_id === REQ_TICKS) {
                    if (msg.subscription?.id) subIdRef.current = msg.subscription.id;
                    const prices: (number | string)[] = msg.history?.prices ?? [];
                    if (prices.length > 0) {
                        const wPrices = prices.map(p => Number(p)).slice(-tickCountRef.current);
                        setPriceWindow(wPrices);
                        setDigitsWindow(wPrices.map(p => getDigit(p)));
                        // Set live price to latest
                        const latest = wPrices[wPrices.length - 1];
                        if (latest !== undefined) setLivePrice(latest);
                    }
                    setLiveLoading(false);
                }

                // ── tick ──────────────────────────────────────────────────
                if (msg_type === 'tick') {
                    if (!subIdRef.current && msg.tick?.subscription?.id) {
                        subIdRef.current = msg.tick.subscription.id;
                    }
                    const quote = msg.tick?.quote;
                    if (quote !== undefined && selectedSymbolRef.current === msg.tick?.symbol) {
                        const digit = getDigit(quote);

                        setPriceWindow(prev =>
                            [...prev.slice(-(tickCountRef.current - 1)), quote]
                        );
                        setDigitsWindow(prev =>
                            [...prev.slice(-(tickCountRef.current - 1)), digit]
                        );
                        setLivePrice(quote);
                        setLastDigit(digit);

                        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
                        flashTimerRef.current = setTimeout(() => setLastDigit(null), 700);
                    }
                }
            } catch (err) {
                console.error('[DCircles] WS parse error:', err);
            }
        };

        ws.onerror = () => {
            setConnStatus('error');
            setLiveLoading(false);
        };

        ws.onclose = () => {
            setConnStatus('closed');
            setLiveLoading(false);
            subIdRef.current = null;
            // Auto-reconnect after 3s unless deliberately destroyed
            if (!isDestroyedRef.current) {
                if (reconnTimerRef.current) clearTimeout(reconnTimerRef.current);
                reconnTimerRef.current = setTimeout(() => connect(), 3000);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [getDigit]);

    // ── Mount / Unmount ─────────────────────────────────────────────────────
    useEffect(() => {
        isDestroyedRef.current = false;
        connect();

        // Page Visibility API — reconnect when tab becomes visible again
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                const ws = wsRef.current;
                const isAlive = ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING);
                if (!isAlive) {
                    connect();
                } else if (ws && ws.readyState === WebSocket.OPEN && !subIdRef.current) {
                    // WS is live but subscription was lost — re-subscribe
                    if (subIdRef.current) {
                        ws.send(JSON.stringify({ forget: subIdRef.current }));
                        subIdRef.current = null;
                    }
                    ws.send(JSON.stringify({
                        ticks_history: selectedSymbolRef.current,
                        end:           'latest',
                        count:         tickCountRef.current,
                        style:         'ticks',
                        subscribe:     1,
                        req_id:        REQ_TICKS,
                    }));
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            isDestroyedRef.current = true;
            document.removeEventListener('visibilitychange', handleVisibility);
            if (flashTimerRef.current)  clearTimeout(flashTimerRef.current);
            if (reconnTimerRef.current) clearTimeout(reconnTimerRef.current);
            const ws = wsRef.current;
            if (ws) {
                if (subIdRef.current && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ forget: subIdRef.current }));
                }
                ws.close();
                wsRef.current = null;
            }
        };
    }, [connect]);

    // ── Symbol change ───────────────────────────────────────────────────────
    const handleSymbolChange = useCallback((symbol: string) => {
        if (!symbol || symbol === selectedSymbolRef.current) return;
        selectedSymbolRef.current = symbol;
        setSelectedSymbol(symbol);
        localStorage.setItem('dcircles_selected_market', symbol);

        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        if (subIdRef.current) {
            ws.send(JSON.stringify({ forget: subIdRef.current }));
            subIdRef.current = null;
        }
        setLiveLoading(true);
        ws.send(JSON.stringify({
            ticks_history: symbol,
            end:           'latest',
            count:         tickCountRef.current,
            style:         'ticks',
            subscribe:     1,
            req_id:        REQ_TICKS,
        }));
    }, []);

    // ── Tick count change ───────────────────────────────────────────────────
    const applyTickCount = useCallback((newCount: number) => {
        const clamped = Math.min(5000, Math.max(50, newCount));
        tickCountRef.current = clamped;
        setTickInputVal(String(clamped));

        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        if (subIdRef.current) {
            ws.send(JSON.stringify({ forget: subIdRef.current }));
            subIdRef.current = null;
        }
        setLiveLoading(true);
        ws.send(JSON.stringify({
            ticks_history: selectedSymbolRef.current,
            end:           'latest',
            count:         clamped,
            style:         'ticks',
            subscribe:     1,
            req_id:        REQ_TICKS,
        }));
    }, []);

    const handleTickKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            const v = parseInt(tickInputVal, 10);
            if (!isNaN(v)) applyTickCount(v);
            (e.target as HTMLInputElement).blur();
        }
    };

    // ── Computed stats ──────────────────────────────────────────────────────
    const digitStats = useMemo(() => {
        const counts = Array.from({ length: 10 }, (_, d) => ({ digit: d, count: 0, percentage: 0 }));
        for (const d of digitsWindow) counts[d].count++;
        const total = digitsWindow.length || 1;
        return counts.map(item => ({
            ...item,
            percentage: Number(((item.count / total) * 100).toFixed(2)),
        }));
    }, [digitsWindow]);

    const { hottestDigit, coldestDigit } = useMemo(() => {
        if (!digitStats.length) return { hottestDigit: -1, coldestDigit: -1 };
        const sorted = [...digitStats].sort((a, b) => b.count - a.count);
        return { hottestDigit: sorted[0].digit, coldestDigit: sorted[sorted.length - 1].digit };
    }, [digitStats]);

    const evenOddStats = useMemo(() => {
        let even = 0, odd = 0;
        digitsWindow.forEach(d => { if (d % 2 === 0) even++; else odd++; });
        const total = digitsWindow.length || 1;
        const bias = even > odd ? 'EVEN' : odd > even ? 'ODD' : 'NEUTRAL';
        return { evenPct: (even / total) * 100, oddPct: (odd / total) * 100, bias };
    }, [digitsWindow]);

    const riseFallStats = useMemo(() => {
        let rise = 0, fall = 0;
        for (let i = 1; i < priceWindow.length; i++) {
            if (priceWindow[i] > priceWindow[i - 1]) rise++;
            else if (priceWindow[i] < priceWindow[i - 1]) fall++;
        }
        const total = rise + fall || 1;
        const bias = rise > fall ? 'BULLISH' : fall > rise ? 'BEARISH' : 'NEUTRAL';
        return { rise, fall, risePct: (rise / total) * 100, fallPct: (fall / total) * 100, bias };
    }, [priceWindow]);

    const last50 = useMemo(() => digitsWindow.slice(-50), [digitsWindow]);

    const last50RF = useMemo(() => {
        const result: ('R' | 'F')[] = [];
        const slice = priceWindow.slice(-51);
        for (let i = 1; i < slice.length; i++) {
            if (slice[i] > slice[i - 1]) result.push('R');
            else if (slice[i] < slice[i - 1]) result.push('F');
        }
        return result.slice(-50);
    }, [priceWindow]);

    const isOffline       = connStatus === 'closed' || connStatus === 'error';
    const totalTicks      = digitsWindow.length;
    const formattedPrice  = typeof livePrice === 'number'
        ? livePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 })
        : livePrice;

    // ── Render ──────────────────────────────────────────────────────────────
    return (
        <div className='dcircles-page'>

            {/* ─── HEADER ─── */}
            <div className='dcircles-page__header'>
                <div>
                    <h2 className='dcircles-page__title'>DCircles Digit Analysis</h2>
                    <p className='dcircles-page__subtitle'>Live last-digit distribution &amp; pattern engine</p>
                </div>
                <div className='dcircles-page__header-right'>
                    <div className='dcircles-page__price'>
                        <span className='dcircles-page__price-label'>Live Price</span>
                        <span className='dcircles-page__price-value'>{formattedPrice}</span>
                    </div>
                    <div className={`dcircles-page__status dcircles-page__status--${connStatus}`}>
                        <span className='dcircles-page__status-dot' />
                        {connStatus}
                    </div>
                </div>
            </div>

            {/* ─── CONTROLS ─── */}
            <div className='dcircles-page__controls'>
                <div className='dcircles-control-group'>
                    <label htmlFor='dc-symbol'>Market</label>
                    <div className='dcircles-page__select-wrap'>
                        <select
                            id='dc-symbol'
                            value={selectedSymbol}
                            onChange={e => handleSymbolChange(e.target.value)}
                            disabled={symbols.length === 0}
                        >
                            {symbols.length === 0
                                ? <option value=''>Loading markets…</option>
                                : symbols.map(s => <option key={s.symbol} value={s.symbol}>{s.display_name}</option>)
                            }
                        </select>
                        {liveLoading && <span className='dcircles-page__spinner' />}
                    </div>
                </div>

                <div className='dcircles-control-group'>
                    <label htmlFor='dc-ticks'>Ticks</label>
                    <input
                        id='dc-ticks'
                        type='number'
                        value={tickInputVal}
                        onChange={e => setTickInputVal(e.target.value)}
                        onBlur={() => { const v = parseInt(tickInputVal, 10); if (!isNaN(v)) applyTickCount(v); }}
                        onKeyDown={handleTickKeyDown}
                        min='50' max='5000'
                    />
                </div>

                <div className='dcircles-page__summary-inline'>
                    <div className='dcircles-badge'>
                        <span>🔥</span><span>Hot</span>
                        <strong>{hottestDigit >= 0 ? hottestDigit : '—'}</strong>
                    </div>
                    <div className='dcircles-badge'>
                        <span>❄️</span><span>Cold</span>
                        <strong>{coldestDigit >= 0 ? coldestDigit : '—'}</strong>
                    </div>
                    <div className='dcircles-badge'>
                        <span>📊</span><span>Sample</span>
                        <strong>{totalTicks.toLocaleString()}</strong>
                    </div>
                </div>
            </div>

            {isOffline && (
                <div className='dcircles-page__offline'>
                    ⚠ Live data unavailable — reconnecting…
                </div>
            )}

            {/* ─── DIGIT GRID ─── */}
            <div className='dcircles-grid'>
                {digitStats.map(({ digit, percentage }) => {
                    const heat      = getHeat(percentage);
                    const isHottest = digit === hottestDigit;
                    const isLowest  = digit === coldestDigit;
                    const isFlash   = digit === lastDigit;

                    return (
                        <div
                            key={digit}
                            className={[
                                'dcircles-card',
                                `dcircles-card--${heat}`,
                                isHottest ? 'dcircles-card--highest' : '',
                                isLowest  ? 'dcircles-card--lowest'  : '',
                                isFlash   ? 'dcircles-card--flash'   : '',
                            ].join(' ').trim()}
                        >
                            {isFlash && <div className='dcircles-card__cursor'>▼</div>}
                            <div className='dcircles-card__ring'>
                                <svg viewBox='0 0 100 100' className='dcircles-card__svg'>
                                    <circle cx='50' cy='50' r={RING_R} className='dcircles-card__track' />
                                    <circle
                                        cx='50' cy='50' r={RING_R}
                                        className='dcircles-card__arc'
                                        strokeDasharray={RING_C}
                                        strokeDashoffset={RING_C * (1 - Math.min(percentage / RING_MAX_PCT, 1))}
                                    />
                                </svg>
                                <div className='dcircles-card__num'>{digit}</div>
                            </div>
                            <div className='dcircles-card__pct-pill'>{percentage}%</div>
                        </div>
                    );
                })}
            </div>

            {/* ─── EVEN / ODD PANEL ─── */}
            <div className='dcircles-analysis-block'>
                <div className='dcircles-analysis-block__title'>Even / Odd Pattern</div>
                <div className='dcircles-analysis-block__bars'>
                    <div className='dcircles-bar dcircles-bar--even'>
                        <strong>{evenOddStats.evenPct.toFixed(1)}%</strong>
                        <span>EVEN</span>
                    </div>
                    <div className='dcircles-bar dcircles-bar--odd'>
                        <strong>{evenOddStats.oddPct.toFixed(1)}%</strong>
                        <span>ODD</span>
                    </div>
                </div>
                <div className='dcircles-analysis-block__trail-label'>Last 50 Digits Pattern</div>
                <div className='dcircles-analysis-block__trail'>
                    {last50.map((d, i) => (
                        <span key={i} className={`dcircles-badge-dot dcircles-badge-dot--${d % 2 === 0 ? 'even' : 'odd'}`}>
                            {d % 2 === 0 ? 'E' : 'O'}
                        </span>
                    ))}
                </div>
            </div>

            {/* ─── RISE / FALL PANEL ─── */}
            <div className='dcircles-analysis-block'>
                <div className='dcircles-analysis-block__title'>Market Movement</div>
                <div className='dcircles-analysis-block__bars'>
                    <div className='dcircles-bar dcircles-bar--rise'>
                        <strong>{riseFallStats.risePct.toFixed(1)}%</strong>
                        <span>RISE</span>
                    </div>
                    <div className='dcircles-bar dcircles-bar--fall'>
                        <strong>{riseFallStats.fallPct.toFixed(1)}%</strong>
                        <span>FALL</span>
                    </div>
                </div>
                <div className='dcircles-analysis-block__trail-label'>Last 50 Ticks Movement</div>
                <div className='dcircles-analysis-block__trail'>
                    {last50RF.map((rf, i) => (
                        <span key={i} className={`dcircles-badge-dot dcircles-badge-dot--${rf === 'R' ? 'rise' : 'fall'}`}>
                            {rf}
                        </span>
                    ))}
                </div>
            </div>

        </div>
    );
});

export default DCircles;
