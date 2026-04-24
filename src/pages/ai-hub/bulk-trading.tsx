import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import './bulk-trading.scss';

// ── Constants (Synced with DCircles) ──────────────────────────────────────────
const MIN_STAKE   = 0.35;
const RING_R       = 38;
const RING_C       = 2 * Math.PI * RING_R;
const RING_MAX_PCT = 16;

const FALLBACK_SYMBOLS = [
    { symbol: 'R_10',   name: 'Volatility 10 Index',      pip: 3 },
    { symbol: 'R_25',   name: 'Volatility 25 Index',      pip: 3 },
    { symbol: 'R_50',   name: 'Volatility 50 Index',      pip: 2 },
    { symbol: 'R_75',   name: 'Volatility 75 Index',      pip: 2 },
    { symbol: 'R_100',  name: 'Volatility 100 Index',     pip: 2 },
    { symbol: '1HZ10V', name: 'Volatility 10 (1s) Index', pip: 3 },
    { symbol: '1HZ25V', name: 'Volatility 25 (1s) Index', pip: 3 },
    { symbol: '1HZ50V', name: 'Volatility 50 (1s) Index', pip: 2 },
    { symbol: '1HZ75V', name: 'Volatility 75 (1s) Index', pip: 2 },
    { symbol: '1HZ100V', name: 'Volatility 100 (1s) Index', pip: 2 },
];
const KNOWN_PIPS: Record<string, number> = Object.fromEntries(
    FALLBACK_SYMBOLS.map(s => [s.symbol, s.pip])
);

type TTradeType = 'over_under' | 'even_odd' | 'rise_fall' | 'matches_differs';
type THeat = 'hot' | 'warm' | 'neutral' | 'cold';

const TRADE_TYPES: { id: TTradeType; label: string; icon: string; desc: string }[] = [
    { id: 'over_under',       label: 'Over / Under',       icon: '📈', desc: 'Predict whether the last digit will be over or under a chosen digit' },
    { id: 'even_odd',         label: 'Even / Odd',         icon: '⚖️', desc: 'Predict whether the last digit will be even or odd' },
    { id: 'rise_fall',        label: 'Rise / Fall',        icon: '🔼', desc: 'Predict whether the next tick will be higher or lower' },
    { id: 'matches_differs',  label: 'Matches / Differs',  icon: '🎯', desc: 'Predict whether the last digit will match or differ from a chosen digit' },
];

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

const getDigit = (price: number, pip: number) => {
    const s = price.toFixed(pip);
    return Number(s[s.length - 1]);
};

const getHeat = (pct: number): THeat => {
    if (pct >= 12.5) return 'hot';
    if (pct >= 10.5) return 'warm';
    if (pct >= 8.5)  return 'neutral';
    return 'cold';
};

// ── useAuthWS hook ─────────────────────────────────────────────────────────────
function useAuthWS() {
    const wsRef         = useRef<WebSocket | null>(null);
    const [wsUrl, setWsUrl]   = useState<string | null>(null);
    const [status, setStatus] = useState<'connecting' | 'connected' | 'error' | 'unauthenticated'>('connecting');

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const authInfo = OAuthTokenExchangeService.getAuthInfo();
                if (!authInfo?.access_token) {
                    setStatus('unauthenticated');
                    return;
                }
                const url = await DerivWSAccountsService.getAuthenticatedWebSocketURL(authInfo.access_token);
                if (!cancelled) setWsUrl(url);
            } catch (e) {
                if (!cancelled) setStatus('error');
            }
        })();
        return () => { cancelled = true; };
    }, []);

    return { wsRef, wsUrl, status, setStatus };
}

const BulkTradingPage: React.FC = () => {
    const [tradeType,   setTradeType]   = useState<TTradeType>('over_under');
    const [symbol,      setSymbol]      = useState<string>(() =>
        localStorage.getItem('bulk_symbol') ?? '1HZ10V'
    );
    const [tickCount,   setTickCount]   = useState<number>(50);
    const [tickInput,   setTickInput]   = useState<string>('50');

    const [priceWindow,  setPriceWindow]  = useState<number[]>([]);
    const [digitsWindow, setDigitsWindow] = useState<number[]>([]);
    const [livePrice,  setLivePrice]  = useState<number | null>(null);
    const [lastDigit,  setLastDigit]  = useState<number | null>(null);
    const [loading,    setLoading]    = useState(true);

    const symbolRef    = useRef(symbol);
    const tickCountRef = useRef(tickCount);
    const pipRef       = useRef<Record<string, number>>({ ...KNOWN_PIPS });
    const subIdRef     = useRef<string | null>(null);
    const reconnTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
    const flashTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
    const destroyed    = useRef(false);

    useEffect(() => { symbolRef.current   = symbol;    }, [symbol]);
    useEffect(() => { tickCountRef.current = tickCount; }, [tickCount]);

    const { wsRef, wsUrl, status, setStatus } = useAuthWS();

    const subscribe = useCallback((sym: string) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        if (subIdRef.current) {
            ws.send(JSON.stringify({ forget: subIdRef.current }));
            subIdRef.current = null;
        }
        setLoading(true);
        setPriceWindow([]);
        setDigitsWindow([]);

        const req = {
            ticks_history: sym,
            end:           'latest',
            count:         tickCountRef.current,
            style:         'ticks',
            subscribe:     1,
            req_id:        1001,
        };
        ws.send(JSON.stringify(req));
    }, [wsRef]);

    useEffect(() => {
        if (!wsUrl) return;
        destroyed.current = false;

        const connect = () => {
            if (destroyed.current) return;
            setStatus('connecting');

            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                setStatus('connected');
                subscribe(symbolRef.current);
            };

            ws.onmessage = ({ data }) => {
                try {
                    const msg = JSON.parse(data);
                    const { msg_type } = msg;

                    if (msg_type === 'history' && msg.req_id === 1001) {
                        subIdRef.current = msg.subscription?.id ?? null;
                        const prices: number[] = (msg.history?.prices ?? []).map(Number);
                        
                        if (msg.pip_size != null) {
                            pipRef.current = { ...pipRef.current, [symbolRef.current]: Number(msg.pip_size) };
                        }

                        const pip = pipRef.current[symbolRef.current] ?? 2;
                        const sliced = prices.slice(-tickCountRef.current);
                        setPriceWindow(sliced);
                        setDigitsWindow(sliced.map(p => getDigit(p, pip)));
                        if (sliced.length) setLivePrice(sliced[sliced.length - 1]);
                        setLoading(false);
                    }

                    if (msg_type === 'tick') {
                        const t = msg.tick ?? {};
                        const tickSubId = t.id ?? t.subscription?.id;
                        if (!subIdRef.current && tickSubId) subIdRef.current = tickSubId;

                        if (t.pip_size != null) {
                            const tSym = t.symbol ?? t.underlying ?? symbolRef.current;
                            pipRef.current = { ...pipRef.current, [tSym]: Number(t.pip_size) };
                        }

                        const quote: number | undefined =
                            t.quote !== undefined ? Number(t.quote)  :
                            t.ask   !== undefined ? Number(t.ask)    :
                            t.bid   !== undefined ? Number(t.bid)    : undefined;

                        const tickSym = t.symbol ?? t.underlying ?? '';
                        const sameStream = !tickSym || tickSym === symbolRef.current || tickSubId === subIdRef.current;

                        if (quote !== undefined && sameStream) {
                            const pip  = pipRef.current[symbolRef.current] ?? 2;
                            const digit = getDigit(quote, pip);
                            setPriceWindow(prev => [...prev.slice(-(tickCountRef.current - 1)), quote]);
                            setDigitsWindow(prev => [...prev.slice(-(tickCountRef.current - 1)), digit]);
                            setLivePrice(quote);
                            setLastDigit(digit);

                            if (flashTimer.current) clearTimeout(flashTimer.current);
                            flashTimer.current = setTimeout(() => setLastDigit(null), 700);
                        }
                    }

                    if (msg.error) setLoading(false);
                } catch (err) { }
            };

            ws.onerror = () => {
                setStatus('error');
                setLoading(false);
            };

            ws.onclose = (e) => {
                setStatus('connecting');
                setLoading(false);
                subIdRef.current = null;
                if (!destroyed.current) {
                    if (reconnTimer.current) clearTimeout(reconnTimer.current);
                    reconnTimer.current = setTimeout(connect, 3000);
                }
            };
        };

        connect();

        const onFocus = () => {
            const ws = wsRef.current;
            if (!ws || (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING)) connect();
        };
        document.addEventListener('visibilitychange', onFocus);

        return () => {
            destroyed.current = true;
            document.removeEventListener('visibilitychange', onFocus);
            if (reconnTimer.current) clearTimeout(reconnTimer.current);
            if (flashTimer.current)  clearTimeout(flashTimer.current);
            wsRef.current?.close();
        };
    }, [wsUrl, subscribe, setStatus, wsRef]);

    const handleSymbolChange = useCallback((sym: string) => {
        setSymbol(sym);
        symbolRef.current = sym;
        localStorage.setItem('bulk_symbol', sym);
        subscribe(sym);
    }, [subscribe]);

    const handleTickCountChange = useCallback(() => {
        const n = Math.max(10, Math.min(5000, parseInt(tickInput, 10) || 50));
        setTickCount(n);
        tickCountRef.current = n;
        subscribe(symbolRef.current);
    }, [tickInput, subscribe]);

    const stats = useMemo(() => {
        const n = digitsWindow.length;
        if (!n) return null;

        const freq: number[] = Array(10).fill(0);
        digitsWindow.forEach(d => freq[d]++);
        const pct = freq.map(f => (n > 0 ? (f / n) * 100 : 0));

        const evenCount = digitsWindow.filter(d => d % 2 === 0).length;
        const oddCount  = n - evenCount;
        const evenPct   = (evenCount / n) * 100;
        const oddPct    = (oddCount  / n) * 100;

        let rises = 0, falls = 0;
        for (let i = 1; i < priceWindow.length; i++) {
            if (priceWindow[i] > priceWindow[i - 1]) rises++;
            else if (priceWindow[i] < priceWindow[i - 1]) falls++;
        }
        const total_rf = rises + falls || 1;
        const risePct  = (rises / total_rf) * 100;
        const fallPct  = (falls / total_rf) * 100;

        return { freq, pct, evenCount, oddCount, evenPct, oddPct, rises, falls, risePct, fallPct };
    }, [digitsWindow, priceWindow]);

    const { hottestDigit, coldestDigit } = useMemo(() => {
        if (!stats) return { hottestDigit: -1, coldestDigit: -1 };
        const mapped = stats.pct.map((p, i) => ({ digit: i, pct: p }));
        const sorted = [...mapped].sort((a, b) => b.pct - a.pct);
        return { hottestDigit: sorted[0].digit, coldestDigit: sorted[sorted.length - 1].digit };
    }, [stats]);

    const pip = pipRef.current[symbol] ?? 2;
    const tradeTypeInfo = TRADE_TYPES.find(t => t.id === tradeType)!;

    // ── DIGIT ANALYSIS (DCircles Accurate Design) ────────────────────────────
    const renderDigitAnalysis = () => (
        <div className='bt-analysis bt-analysis--digits'>
            <div className='bt-analysis__title'>
                <span>Digit Distribution</span>
                <span className='bt-analysis__subtitle'>Last {digitsWindow.length} ticks</span>
            </div>
            
            <div className='bt-dc-grid'>
                {DIGITS.map(d => {
                    const pct       = stats?.pct[d]  ?? 0;
                    const heat      = getHeat(pct);
                    const isHottest = d === hottestDigit;
                    const isLowest  = d === coldestDigit;
                    const isFlash   = d === lastDigit;

                    return (
                        <div
                            key={d}
                            className={[
                                'bt-dc-card',
                                `bt-dc-card--${heat}`,
                                isHottest ? 'bt-dc-card--highest' : '',
                                isLowest  ? 'bt-dc-card--lowest'  : '',
                                isFlash   ? 'bt-dc-card--flash'   : '',
                            ].join(' ')}
                        >
                            {isFlash && <div className='bt-dc-card__cursor'>▼</div>}
                            <div className='bt-dc-card__ring'>
                                <svg viewBox='0 0 100 100' className='bt-dc-card__svg'>
                                    <circle cx='50' cy='50' r={RING_R} className='bt-dc-card__track' />
                                    <circle
                                        cx='50' cy='50' r={RING_R}
                                        className='bt-dc-card__arc'
                                        strokeDasharray={RING_C}
                                        strokeDashoffset={RING_C * (1 - Math.min(pct / RING_MAX_PCT, 1))}
                                    />
                                </svg>
                                <div className='bt-dc-card__num'>{d}</div>
                            </div>
                            <div className='bt-dc-card__pct-pill'>{pct.toFixed(2)}%</div>
                        </div>
                    );
                })}
            </div>

            <div className='bt-trail'>
                <div className='bt-trail__label'>Last {Math.min(50, digitsWindow.length)} Digits</div>
                <div className='bt-trail__row'>
                    {[...digitsWindow].slice(-50).map((d, i) => (
                        <span
                            key={i}
                            className={`bt-trail__pill ${
                                d >= 5 ? 'bt-trail__pill--high' : 'bt-trail__pill--low'
                            } ${i === Math.min(50, digitsWindow.length) - 1 ? 'bt-trail__pill--latest' : ''}`}
                        >
                            {d}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );

    // ── EVEN / ODD (Simplified - No Grid) ────────────────────────────────────
    const renderEvenOdd = () => (
        <div className='bt-analysis bt-analysis--eo'>
            <div className='bt-analysis__title'>
                <span>Even / Odd Distribution</span>
                <span className='bt-analysis__subtitle'>Last {digitsWindow.length} ticks</span>
            </div>

            <div className='bt-eo-bars'>
                <div className='bt-eo-bar-row'>
                    <span className='bt-eo-bar-row__label'>Even</span>
                    <div className='bt-eo-bar-row__track'>
                        <div
                            className='bt-eo-bar-row__fill bt-eo-bar-row__fill--even'
                            style={{ width: `${stats?.evenPct ?? 0}%` }}
                        />
                    </div>
                    <span className='bt-eo-bar-row__pct'>{(stats?.evenPct ?? 0).toFixed(1)}%</span>
                    <span className='bt-eo-bar-row__count'>({stats?.evenCount ?? 0})</span>
                </div>
                <div className='bt-eo-bar-row'>
                    <span className='bt-eo-bar-row__label'>Odd</span>
                    <div className='bt-eo-bar-row__track'>
                        <div
                            className='bt-eo-bar-row__fill bt-eo-bar-row__fill--odd'
                            style={{ width: `${stats?.oddPct ?? 0}%` }}
                        />
                    </div>
                    <span className='bt-eo-bar-row__pct'>{(stats?.oddPct ?? 0).toFixed(1)}%</span>
                    <span className='bt-eo-bar-row__count'>({stats?.oddCount ?? 0})</span>
                </div>
            </div>

            <div className='bt-streak-box'>
                 <div className='bt-streak-item'>
                    <span className='bt-streak-label'>Current Streak</span>
                    <span className='bt-streak-value'>
                        {(() => {
                           if (!digitsWindow.length) return '—';
                           const rev = [...digitsWindow].reverse();
                           const type = rev[0] % 2 === 0 ? 'EVEN' : 'ODD';
                           let count = 0;
                           for (const d of rev) {
                               if ((d % 2 === 0 ? 'EVEN' : 'ODD') === type) count++;
                               else break;
                           }
                           return `${count} ${type}`;
                        })()}
                    </span>
                 </div>
            </div>

            <div className='bt-trail'>
                <div className='bt-trail__label'>Pattern Streak</div>
                <div className='bt-trail__row'>
                    {[...digitsWindow].slice(-50).map((d, i) => (
                        <span
                            key={i}
                            className={`bt-trail__pill ${d % 2 === 0 ? 'bt-trail__pill--even' : 'bt-trail__pill--odd'} ${i === Math.min(50, digitsWindow.length) - 1 ? 'bt-trail__pill--latest' : ''}`}
                        >
                            {d % 2 === 0 ? 'E' : 'O'}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );

    // ── RISE / FALL ──────────────────────────────────────────────────────────
    const renderRiseFall = () => (
        <div className='bt-analysis bt-analysis--rf'>
            <div className='bt-analysis__title'>
                <span>Rise / Fall Analysis</span>
                <span className='bt-analysis__subtitle'>Last {priceWindow.length} ticks</span>
            </div>

            <div className='bt-eo-bars'>
                <div className='bt-eo-bar-row'>
                    <span className='bt-eo-bar-row__label'>🔼 Rise</span>
                    <div className='bt-eo-bar-row__track'>
                        <div
                            className='bt-eo-bar-row__fill bt-eo-bar-row__fill--rise'
                            style={{ width: `${stats?.risePct ?? 0}%` }}
                        />
                    </div>
                    <span className='bt-eo-bar-row__pct'>{(stats?.risePct ?? 0).toFixed(1)}%</span>
                </div>
                <div className='bt-eo-bar-row'>
                    <span className='bt-eo-bar-row__label'>🔽 Fall</span>
                    <div className='bt-eo-bar-row__track'>
                        <div
                            className='bt-eo-bar-row__fill bt-eo-bar-row__fill--fall'
                            style={{ width: `${stats?.fallPct ?? 0}%` }}
                        />
                    </div>
                    <span className='bt-eo-bar-row__pct'>{(stats?.fallPct ?? 0).toFixed(1)}%</span>
                </div>
            </div>

            <div className='bt-trail'>
                <div className='bt-trail__label'>Tick Direction</div>
                <div className='bt-trail__row'>
                    {[...priceWindow].slice(-51).map((p, i, arr) => {
                        if (i === 0) return null;
                        const isRise = p > arr[i - 1];
                        return (
                            <span
                                key={i}
                                className={`bt-trail__pill ${isRise ? 'bt-trail__pill--rise' : 'bt-trail__pill--fall'} ${i === arr.length - 1 ? 'bt-trail__pill--latest' : ''}`}
                            >
                                {isRise ? '▲' : '▼'}
                            </span>
                        );
                    })}
                </div>
            </div>
        </div>
    );

    const renderStatusBanner = () => {
        if (status === 'unauthenticated') return <div className='bt-banner bt-banner--warn'>⚠️ Not Logged In</div>;
        if (status === 'error') return <div className='bt-banner bt-banner--error'>✖ Error</div>;
        if (status === 'connecting') return <div className='bt-banner bt-banner--info'>⟳ Connecting</div>;
        return <div className='bt-banner bt-banner--ok'>● Live</div>;
    };

    return (
        <div className='bt-page'>
            <div className='bt-controls'>
                <div className='bt-controls__left'>
                    {renderStatusBanner()}
                    {livePrice !== null && (
                        <div className='bt-live-price'>
                            <span className='bt-live-price__label'>{symbol}</span>
                            <span className='bt-live-price__value'>{livePrice.toFixed(pip)}</span>
                            {lastDigit !== null && (
                                <span className='bt-live-price__digit'>{lastDigit}</span>
                            )}
                        </div>
                    )}
                </div>

                <div className='bt-controls__right'>
                    <select
                        className='bt-select'
                        value={symbol}
                        onChange={e => handleSymbolChange(e.target.value)}
                    >
                        {FALLBACK_SYMBOLS.map(s => (
                            <option key={s.symbol} value={s.symbol}>{s.name}</option>
                        ))}
                    </select>
                    <div className='bt-tick-input'>
                        <input
                            type='number'
                            min={10}
                            max={5000}
                            value={tickInput}
                            onChange={e => setTickInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleTickCountChange()}
                        />
                        <button onClick={handleTickCountChange}>GO</button>
                    </div>
                </div>
            </div>

            <div className='bt-type-tabs'>
                {TRADE_TYPES.map(t => (
                    <button
                        key={t.id}
                        className={`bt-type-tab ${tradeType === t.id ? 'bt-type-tab--active' : ''}`}
                        onClick={() => setTradeType(t.id)}
                    >
                        <span>{t.icon}</span>
                        <span>{t.label}</span>
                    </button>
                ))}
            </div>

            <div className='bt-type-desc'>{tradeTypeInfo.desc}</div>

            <div className='bt-content'>
                {loading ? (
                    <div className='bt-loading'>
                        <div className='bt-loading__spinner' />
                        <span>Loading Market Data…</span>
                    </div>
                ) : (
                    <>
                        {(tradeType === 'over_under' || tradeType === 'matches_differs') && renderDigitAnalysis()}
                        {tradeType === 'even_odd'   && renderEvenOdd()}
                        {tradeType === 'rise_fall'  && renderRiseFall()}
                    </>
                )}
            </div>
        </div>
    );
};

export default BulkTradingPage;
