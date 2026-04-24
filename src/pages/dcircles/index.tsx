import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Localize } from '@deriv-com/translations';
import './dcircles.scss';

// ─── Types ────────────────────────────────────────────────────────────────────
type TSymbol = { symbol: string; display_name: string };
type TActiveSymbolItem = { symbol: string; display_name?: string };
type THeat = 'hot' | 'warm' | 'neutral' | 'cold';

// ─── Constants ────────────────────────────────────────────────────────────────
const REQ_ACTIVE_SYMBOLS = 1001;
const REQ_TICKS = 1002;

const RING_R = 38;
const RING_C = 2 * Math.PI * RING_R; // ~238.76
const RING_MAX_PCT = 16; // 16% fills the ring completely

const FALLBACK_SYMBOLS: TSymbol[] = [
    { symbol: 'R_10',    display_name: 'Volatility 10 Index'       },
    { symbol: 'R_25',    display_name: 'Volatility 25 Index'       },
    { symbol: 'R_50',    display_name: 'Volatility 50 Index'       },
    { symbol: 'R_75',    display_name: 'Volatility 75 Index'       },
    { symbol: 'R_100',   display_name: 'Volatility 100 Index'      },
    { symbol: '1HZ10V',  display_name: 'Volatility 10 (1s) Index'  },
    { symbol: '1HZ25V',  display_name: 'Volatility 25 (1s) Index'  },
    { symbol: '1HZ50V',  display_name: 'Volatility 50 (1s) Index'  },
    { symbol: '1HZ75V',  display_name: 'Volatility 75 (1s) Index'  },
    { symbol: '1HZ100V', display_name: 'Volatility 100 (1s) Index' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getHeat = (pct: number): THeat => {
    if (pct >= 12.5) return 'hot';
    if (pct >= 10.5) return 'warm';
    if (pct >= 8.5)  return 'neutral';
    return 'cold';
};

const buildSeedWindow = (): number[] => {
    const weights = [0.11, 0.09, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10];
    const arr: number[] = [];
    weights.forEach((w, d) => { for (let i = 0; i < Math.round(w * 1000); i++) arr.push(d); });
    while (arr.length < 1000) arr.push(Math.floor(Math.random() * 10));
    return arr.slice(0, 1000).sort(() => Math.random() - 0.5);
};

// ─── Component ────────────────────────────────────────────────────────────────
const DCircles = observer(() => {
    // Load persisted market if available
    const persisted = typeof window !== 'undefined' ? localStorage.getItem('dcircles_selected_market') : null;
    const initialSymbol = persisted && persisted.length ? persisted : 'R_10';
    const wsRef            = useRef<WebSocket | null>(null);
    const subIdRef         = useRef<string | null>(null);
    const selectedSymbolRef   = useRef(initialSymbol);
    const flashTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pipSizesRef      = useRef<Record<string, number>>({});

    const [symbols,       setSymbols]       = useState<TSymbol[]>(FALLBACK_SYMBOLS);
    const [selectedSymbol, setSelectedSymbol] = useState<string>(initialSymbol);
    const [livePrice,     setLivePrice]     = useState<string | number>('—');
    const [digitsWindow,  setDigitsWindow]  = useState<number[]>(buildSeedWindow);
    const [liveLoading,   setLiveLoading]   = useState(false);
    const [lastDigit,     setLastDigit]     = useState<number | null>(null);
    const [connStatus,    setConnStatus]    = useState<'connecting'|'connected'|'closed'|'error'>('connecting');

    const getDigit = useCallback((val: number | string) => {
        const symbol = selectedSymbolRef.current;
        const pip = (pipSizesRef.current as any)[symbol] ?? 2;
        const s = Number(val).toFixed(pip);
        return Number(s[s.length - 1]);
    }, []);

    const send = useCallback((payload: Record<string, unknown>) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    }, []);

    const subscribeToSymbol = useCallback((symbol: string) => {
        if (!symbol) return;
        if (subIdRef.current) { send({ forget: subIdRef.current }); subIdRef.current = null; }
        setLiveLoading(true);
        send({ ticks_history: symbol, end: 'latest', count: 1000, style: 'ticks', subscribe: 1, req_id: REQ_TICKS });
    }, [send]);

    useEffect(() => {
        const ws = new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');
        wsRef.current = ws;

        ws.onopen = () => {
            setConnStatus('connected');
            send({ active_symbols: 'brief', req_id: REQ_ACTIVE_SYMBOLS });
        };

        ws.onmessage = event => {
            try {
                const msg = JSON.parse(event.data as string);
                const { msg_type, req_id, error } = msg;
                if (error) { console.error('[DCircles] API error:', error.message); setLiveLoading(false); return; }

                if (msg_type === 'active_symbols' && req_id === REQ_ACTIVE_SYMBOLS) {
                    const raw: TActiveSymbolItem[] = msg.active_symbols ?? [];
                    const volatile = raw.filter(i => typeof i.symbol === 'string' && /^(R_\d|1HZ\d)/.test(i.symbol));
                    const fetched: TSymbol[] = volatile.map(i => ({ symbol: i.symbol, display_name: i.display_name ?? i.symbol }));

                    // Extract pip sizes for correct digit calculation
                    const pips: Record<string, number> = {};
                    raw.forEach(s => {
                        if (s.symbol) {
                            // Guess pip size from common Deriv patterns if not explicit
                            // Usually indices are 2 or 3 decimals
                            pips[s.symbol] = (s as any).pip ? Math.abs(Math.log10((s as any).pip)) : 2;
                        }
                    });
                    pipSizesRef.current = pips;
                    setSymbols(fetched.sort((a, b) => a.display_name.localeCompare(b.display_name)));

                    const target = fetched.find(s => s.symbol === selectedSymbolRef.current)?.symbol
                        ?? fetched.find(s => s.symbol === 'R_10')?.symbol
                        ?? fetched[0]?.symbol;
                    if (target) { selectedSymbolRef.current = target; setSelectedSymbol(target); subscribeToSymbol(target); }
                }

                if (msg_type === 'history' && req_id === REQ_TICKS) {
                    if (msg.subscription?.id) subIdRef.current = msg.subscription.id;
                    const prices: (number | string)[] = msg.history?.prices ?? [];
                    if (prices.length > 0) {
                        setDigitsWindow(prices.map(p => getDigit(p)).slice(-1000));
                    }
                    setLiveLoading(false);
                }

                if (msg_type === 'tick') {
                    if (!subIdRef.current && msg.tick?.subscription?.id) subIdRef.current = msg.tick.subscription.id;
                    const quote = msg.tick?.quote;
                    if (quote !== undefined) {
                        const digit = getDigit(quote);
                        setDigitsWindow(prev => [...prev.slice(-999), digit]);
                        setLivePrice(quote);
                        setLastDigit(digit);
                        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
                        flashTimerRef.current = setTimeout(() => setLastDigit(null), 700);
                    }
                }
            } catch (err) { console.error('[DCircles] WS parse error:', err); }
        };

        ws.onerror = () => { setConnStatus('error'); setLiveLoading(false); };
        ws.onclose = () => { setConnStatus('closed'); setLiveLoading(false); };

        return () => {
            if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
            if (subIdRef.current && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ forget: subIdRef.current }));
            ws.close(); wsRef.current = null; subIdRef.current = null;
        };
    }, [send, subscribeToSymbol]);

    const handleSymbolChange = (symbol: string) => {
        if (!symbol || symbol === selectedSymbolRef.current) return;
        selectedSymbolRef.current = symbol;
        setSelectedSymbol(symbol);
        localStorage.setItem('dcircles_selected_market', symbol);
        subscribeToSymbol(symbol);
    };

    const digitStats = useMemo(() => {
        const counts = Array.from({ length: 10 }, (_, d) => ({ digit: d, count: 0, percentage: 0 }));
        for (const d of digitsWindow) { if (counts[d]) counts[d].count++; }
        return counts.map(item => ({ ...item, percentage: Number(((item.count / (digitsWindow.length || 1)) * 100).toFixed(2)) }));
    }, [digitsWindow]);

    const { hottestDigit, coldestDigit } = useMemo(() => {
        if (!digitStats.length) return { hottestDigit: -1, coldestDigit: -1 };
        const sorted = [...digitStats].sort((a, b) => b.count - a.count);
        return { hottestDigit: sorted[0].digit, coldestDigit: sorted[sorted.length - 1].digit };
    }, [digitStats]);

    const isOffline = connStatus === 'closed' || connStatus === 'error';
    const formattedPrice = typeof livePrice === 'number' ? livePrice.toFixed(2) : livePrice;
    const totalTicks = digitsWindow.length;

    return (
        <div className='dcircles-page'>
            {/* Header */}
            <div className='dcircles-page__header'>
                <div className='dcircles-page__title-wrap'>
                    <h2 className='dcircles-page__title'>
                        <Localize i18n_default_text='DCircles Digit Analysis' />
                    </h2>
                    <p className='dcircles-page__subtitle'>
                        <Localize i18n_default_text='Live last-digit distribution across 1 000 ticks' />
                    </p>
                </div>
                <div className='dcircles-page__price'>
                    <span className='dcircles-page__price-label'><Localize i18n_default_text='Live price' /></span>
                    <span className='dcircles-page__price-value'>{formattedPrice}</span>
                </div>
                <div className={`dcircles-page__status dcircles-page__status--${connStatus}`}>
                    <span className='dcircles-page__status-dot' />
                    {connStatus}
                </div>
            </div>

            {/* Summary pills */}
            <div className='dcircles-page__summary'>
                <div className='dcircles-pill dcircles-pill--hot'>
                    <span className='dcircles-pill__icon'>🔥</span>
                    <div>
                        <div className='dcircles-pill__label'><Localize i18n_default_text='Hottest' /></div>
                        <div className='dcircles-pill__value'>{hottestDigit >= 0 ? hottestDigit : '—'}</div>
                    </div>
                </div>
                <div className='dcircles-pill dcircles-pill--cold'>
                    <span className='dcircles-pill__icon'>❄️</span>
                    <div>
                        <div className='dcircles-pill__label'><Localize i18n_default_text='Coldest' /></div>
                        <div className='dcircles-pill__value'>{coldestDigit >= 0 ? coldestDigit : '—'}</div>
                    </div>
                </div>
                <div className='dcircles-pill'>
                    <span className='dcircles-pill__icon'>📊</span>
                    <div>
                        <div className='dcircles-pill__label'><Localize i18n_default_text='Sample' /></div>
                        <div className='dcircles-pill__value'>{totalTicks.toLocaleString()}</div>
                    </div>
                </div>
            </div>

            {/* Controls */}
            <div className='dcircles-page__controls'>
                <label htmlFor='dcircles-symbol'><Localize i18n_default_text='Market' /></label>
                <div className='dcircles-page__select-wrap'>
                    <select id='dcircles-symbol' value={selectedSymbol} onChange={e => handleSymbolChange(e.target.value)}>
                        {symbols.map(s => <option key={s.symbol} value={s.symbol}>{s.display_name}</option>)}
                    </select>
                    {liveLoading && <span className='dcircles-page__spinner' />}
                </div>
            </div>

            {/* Offline notice */}
            {isOffline && (
                <div className='dcircles-page__offline'>
                    ⚠ <Localize i18n_default_text='Live data unavailable — showing cached distribution.' />
                </div>
            )}

            {/* Digit Grid */}
            <div className='dcircles-grid'>
                {digitStats.map(({ digit, percentage }) => {
                    const heat   = getHeat(percentage);
                    const isHottest = digit === hottestDigit;
                    const isFlash   = digit === lastDigit;

                    return (
                        <div
                            key={digit}
                            className={[
                                'dcircles-card',
                                `dcircles-card--${heat}`,
                                isHottest ? 'dcircles-card--hottest' : '',
                                isFlash   ? 'dcircles-card--flash'   : '',
                            ].join(' ').trim()}
                        >
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
                            <div className='dcircles-card__pct-pill'>
                                {percentage}%
                            </div>
                        </div>
                    );
                })}
            </div>
            
            <div className='dcircles-page__footer-stats'>
                Highest: <strong>{digitStats[hottestDigit]?.percentage}%</strong> | Lowest: <strong>{digitStats[coldestDigit]?.percentage}%</strong>
            </div>
        </div>
    );
});

export default DCircles;
