import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { authData$ } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import './bulk-trading.scss';

// ── Constants (Synced with DCircles) ──────────────────────────────────────────
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
    if (price === undefined || isNaN(price)) return 0;
    const s = price.toFixed(pip);
    return Number(s[s.length - 1]);
};

const getHeat = (pct: number): THeat => {
    if (pct >= 12.5) return 'hot';
    if (pct >= 10.5) return 'warm';
    if (pct >= 8.5)  return 'neutral';
    return 'cold';
};

// ── Types for Execution ────────────────────────────────────────────────────────
interface ITradeResult {
    id: string;
    contract_id: string | number;
    type: string;
    symbol: string;
    status: 'pending' | 'won' | 'lost' | 'open';
    entry: string;
    exit?: string;
    profit: number;
    stake: number;
    time: number;
}

interface IPopupData {
    id: string;
    title: string;
    value: string;
    extra?: string;
}

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

const BulkTradingPage: React.FC = observer(() => {
    const [tradeType,   setTradeType]   = useState<TTradeType>(() => (localStorage.getItem('bulk_trade_type') as TTradeType) ?? 'over_under');
    const [symbol,      setSymbol]      = useState<string>(() => localStorage.getItem('bulk_symbol') ?? '1HZ10V');
    const [tickCount,   setTickCount]   = useState<number>(() => Number(localStorage.getItem('bulk_ticks')) || 1000);
    const [tickInput,   setTickInput]   = useState<string>(() => localStorage.getItem('bulk_ticks') ?? '1000');

    // ── Trading Config State ──
    const [stake, setStake] = useState<string>('0.35');
    const [prediction, setPrediction] = useState<number>(5);
    const [stopLoss, setStopLoss] = useState<string>('10');
    const [takeProfit, setTakeProfit] = useState<string>('10');
    const [bulkCount, setBulkCount] = useState<number>(1);
    const [runMode, setRunMode] = useState<'once' | 'frequent'>('once');
    const [resultsTab, setResultsTab] = useState<'transactions' | 'analytics'>('transactions');

    const [priceWindow,  setPriceWindow]  = useState<number[]>([]);
    const [digitsWindow, setDigitsWindow] = useState<number[]>([]);
    const [livePrice,  setLivePrice]  = useState<number | null>(null);
    const [lastDigit,  setLastDigit]  = useState<number | null>(null);
    const [loading,    setLoading]    = useState(true);
    const [executing,  setExecuting]  = useState(false);

    // ── Persistence ──
    const [trades, setTrades] = useState<ITradeResult[]>(() => {
        try {
            const saved = localStorage.getItem('bt_trades');
            return saved ? JSON.parse(saved) : [];
        } catch (e) { return []; }
    });

    useEffect(() => {
        localStorage.setItem('bt_trades', JSON.stringify(trades.slice(0, 100)));
    }, [trades]);

    const [popup, setPopup] = useState<{ data: IPopupData; timeout?: any } | null>(null);

    const symbolRef    = useRef(symbol);
    const tickCountRef = useRef(tickCount);
    const pipRef       = useRef<Record<string, number>>({ ...KNOWN_PIPS });
    const subIdRef     = useRef<string | null>(null);
    const reconnTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
    const flashTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
    const destroyed    = useRef(false);

    useEffect(() => { symbolRef.current   = symbol;    }, [symbol]);
    useEffect(() => { tickCountRef.current = tickCount; }, [tickCount]);
    useEffect(() => { localStorage.setItem('bulk_trade_type', tradeType); }, [tradeType]);

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
                            setPriceWindow(prev => {
                                const nw = [...prev, quote];
                                return nw.slice(-tickCountRef.current);
                            });
                            setDigitsWindow(prev => {
                                const nw = [...prev, digit];
                                return nw.slice(-tickCountRef.current);
                            });
                            setLivePrice(quote);
                            setLastDigit(digit);

                            if (flashTimer.current) clearTimeout(flashTimer.current);
                            flashTimer.current = setTimeout(() => setLastDigit(null), 700);
                        }
                    }

                    // ── Handle Result Stream ──
                    if (msg_type === 'proposal_open_contract') {
                        const poc = msg.proposal_open_contract;
                        if (poc) {
                            setTrades(prev => prev.map(tr => {
                                if (String(tr.contract_id) === String(poc.contract_id)) {
                                    return {
                                        ...tr,
                                        status: poc.status === 'won' ? 'won' : (poc.status === 'lost' ? 'lost' : 'open'),
                                        exit: poc.exit_tick_display_value ?? poc.exit_tick ?? tr.exit,
                                        profit: Number(poc.profit ?? 0)
                                    };
                                }
                                return tr;
                            }));
                        }
                    }

                    if (msg.error) setLoading(false);
                } catch (err) { }
            };

            ws.onerror = () => {
                setStatus('error');
                setLoading(false);
            };

            ws.onclose = () => {
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

    const [balance, setBalance] = useState<string>('0.00');
    const [currency, setCurrency] = useState<string>('USD');

    useEffect(() => {
        const sub = api_base.api?.onMessage().subscribe((envelope: any) => {
            const msg = envelope?.data ?? envelope ?? {};
            
            if (msg.msg_type === 'balance') {
                setBalance(Number(msg.balance.balance).toFixed(2));
                setCurrency(msg.balance.currency);
            }
            if (msg.msg_type === 'transaction') {
                const tx = msg.transaction;
                if (tx && tx.action === 'sell') {
                    setTrades(prev => prev.map(tr => {
                        if (String(tr.contract_id) === String(tx.contract_id)) {
                            return {
                                ...tr,
                                status: tx.amount > 0 ? 'won' : 'lost',
                                profit: Number(tx.amount || 0)
                            };
                        }
                        return tr;
                    }));
                }
            }
            if (msg.msg_type === 'proposal_open_contract') {
                const poc = msg.proposal_open_contract;
                if (poc) {
                    console.log(`[BulkTrade] Received POC for ${poc.contract_id}, is_sold: ${poc.is_sold}, status: ${poc.status}`);
                    setTrades(prev => prev.map(tr => {
                        if (String(tr.contract_id) === String(poc.contract_id)) {
                            const isSold = !!poc.is_sold;
                            const finalStatus = isSold ? (poc.status === 'won' ? 'won' : 'lost') : 'open';
                            
                            return {
                                ...tr,
                                status: finalStatus,
                                exit: poc.exit_tick_display_value ?? poc.exit_tick ?? poc.sell_price ?? tr.exit,
                                profit: Number(poc.profit_display_value ?? poc.profit ?? 0)
                            };
                        }
                        return tr;
                    }));
                }
            }
        });
        return () => sub?.unsubscribe();
    }, []);

    // ── Bulk Execution Logic ──
    const executeBulkTrade = async (side: string) => {
        if (executing || status !== 'connected') return;
        setExecuting(true);

        const currentStake = parseFloat(stake) || 0.35;
        const currentSymbol = symbolRef.current;

        try {
            console.log(`[BulkTrade] Starting ${side.toUpperCase()} execution for ${bulkCount} positions...`);

            // 1. Prepare Contract Type
            let contract_type = '';
            let barrier = undefined;

            if (tradeType === 'over_under') {
                contract_type = side === 'over' ? 'DIGITOVER' : 'DIGITUNDER';
                barrier = prediction.toString();
            } else if (tradeType === 'even_odd') {
                contract_type = side === 'even' ? 'DIGITEVEN' : 'DIGITODD';
            } else if (tradeType === 'rise_fall') {
                contract_type = side === 'rise' ? 'CALL' : 'PUT';
            } else if (tradeType === 'matches_differs') {
                contract_type = side === 'matches' ? 'DIGITMATCH' : 'DIGITDIFF';
                barrier = prediction.toString();
            }

// 2. Execute Direct Batch Buy (Bypasses proposal/caching issues)
            console.log(`[BulkTrade] Executing direct batch-buy for ${bulkCount} positions...`);
            
            const buyPromises = [];
            for (let i = 0; i < bulkCount; i++) {
                // We use "buy: 1" with parameters to bypass the need for a proposal ID
                const buyReq = {
                    buy: '1',
                    price: currentStake * 2, // Max price willing to pay (usually twice the stake is safe)
                    parameters: {
                        amount: currentStake,
                        basis: 'stake',
                        contract_type,
                        currency: authData$.value?.currency || 'USD',
                        duration: 1,
                        duration_unit: 't',
                        underlying_symbol: currentSymbol,
                        barrier: barrier ? barrier.toString() : undefined
                    },
                    subscribe: 1,
                    req_id: 3000 + i
                };
                buyPromises.push(api_base.api.send(buyReq));
            }

            console.log(`[BulkTrade] Sending ${bulkCount} parallel buy requests...`);
            const buyResponses = await Promise.all(buyPromises);

            const newTrades: ITradeResult[] = buyResponses.map((res, i) => {
                if (res.error) {
                    console.error(`[BulkTrade] Position ${i + 1} failed:`, res.error.message);
                    return null;
                }
                const buy = res.buy;
                console.log(`[BulkTrade] ✅ Position ${i + 1} Success! Contract: ${buy.contract_id}`);
                return {
                    id: `bulk-${Date.now()}-${i}`,
                    contract_id: buy.contract_id,
                    type: side.toUpperCase(),
                    symbol: currentSymbol,
                    status: 'open',
                    entry: livePrice?.toFixed(pipRef.current[currentSymbol] ?? 2) ?? '—',
                    profit: 0,
                    stake: currentStake,
                    time: Date.now()
                } as ITradeResult;
            }).filter(t => t !== null) as ITradeResult[];

            setTrades(prev => [...newTrades, ...prev]);

            if (newTrades.length < bulkCount) {
                console.warn(`[BulkTrade] Partial success: ${newTrades.length}/${bulkCount} positions filled.`);
            } else {
                console.log(`[BulkTrade] 🎉 Bulk Execution Complete. ${newTrades.length} positions filled simultaneously.`);
            }

        } catch (err: any) {
            console.error('[BulkTrade] FATAL ERROR:', err);
            alert(`Execution Error: ${err.message || 'Check Console for details'}`);
        } finally {
            setExecuting(false);
        }
    };

    const handleSymbolChange = useCallback((sym: string) => {
        setSymbol(sym);
        symbolRef.current = sym;
        localStorage.setItem('bulk_symbol', sym);
        subscribe(sym);
    }, [subscribe]);

    const handleTickCountChange = useCallback(() => {
        const val = tickInput.trim();
        const n = Math.max(10, Math.min(5000, parseInt(val, 10) || 1000));
        setTickCount(n);
        tickCountRef.current = n;
        localStorage.setItem('bulk_ticks', n.toString());
        subscribe(symbolRef.current);
    }, [tickInput, subscribe]);

    const triggerPopup = (data: IPopupData) => {
        setPopup(prev => {
            if (prev?.timeout) clearTimeout(prev.timeout);
            return { data, timeout: setTimeout(() => setPopup(null), 5000) };
        });
    };

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

    const renderPopupUI = (id: string) => {
        if (!popup || popup.data.id !== id) return null;
        return (
            <div className='bt-mini-popup'>
                <div className='bt-mini-popup__title'>{popup.data.title}</div>
                <div className='bt-mini-popup__value'>{popup.data.value}</div>
                {popup.data.extra && <div className='bt-mini-popup__extra'>{popup.data.extra}</div>}
            </div>
        );
    };

    // ── CONFIGURATION PANEL ──
    const renderConfig = () => (
        <div className='bt-config-panel'>
            <div className='bt-section-header'>
                <h3>⚡ Trade Configuration</h3>
                <div className='bt-run-mode'>
                    <button 
                        className={`bt-mode-btn ${runMode === 'once' ? 'active' : ''}`}
                        onClick={() => setRunMode('once')}
                    >
                        Once
                    </button>
                    <button 
                        className={`bt-mode-btn ${runMode === 'frequent' ? 'active' : ''}`}
                        onClick={() => setRunMode('frequent')}
                    >
                        Frequent
                    </button>
                    <div className='bt-live-wallet'>
                        <span className='bt-wallet-label'>Balance:</span>
                        <span className='bt-wallet-value'>{balance} {currency}</span>
                    </div>
                </div>
            </div>

            <div className='bt-config-grid'>
                {(tradeType === 'over_under' || tradeType === 'matches_differs') && (
                    <div className='bt-config-item'>
                        <label>Target Digit (0-9)</label>
                        <div className='bt-digit-selector'>
                            {DIGITS.map(d => (
                                <button 
                                    key={d} 
                                    className={prediction === d ? 'active' : ''}
                                    onClick={() => setPrediction(d)}
                                >
                                    {d}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className='bt-config-item'>
                    <label>Stake (USD)</label>
                    <input type='text' value={stake} onChange={e => setStake(e.target.value)} />
                </div>

                <div className='bt-config-item'>
                    <label>Bulk Positions</label>
                    <input type='number' value={bulkCount} min={1} max={10} onChange={e => setBulkCount(Number(e.target.value))} />
                </div>

                <div className='bt-config-item'>
                    <label>Risk: Stop Loss</label>
                    <input type='text' value={stopLoss} onChange={e => setStopLoss(e.target.value)} />
                </div>

                <div className='bt-config-item'>
                    <label>Risk: Take Profit</label>
                    <input type='text' value={takeProfit} onChange={e => setTakeProfit(e.target.value)} />
                </div>
            </div>

            <div className='bt-action-buttons'>
                {tradeType === 'over_under' && (
                    <div className='bt-btn-row'>
                        <button className='bt-exec-btn bt-exec-btn--over' onClick={() => executeBulkTrade('over')} disabled={executing}>
                            {executing ? '...' : `BULK OVER ${prediction}`}
                        </button>
                        <button className='bt-exec-btn bt-exec-btn--under' onClick={() => executeBulkTrade('under')} disabled={executing}>
                            {executing ? '...' : `BULK UNDER ${prediction}`}
                        </button>
                    </div>
                )}
                {tradeType === 'even_odd' && (
                    <div className='bt-btn-row'>
                        <button className='bt-exec-btn bt-exec-btn--even' onClick={() => executeBulkTrade('even')} disabled={executing}>
                            {executing ? '...' : 'BULK EVEN'}
                        </button>
                        <button className='bt-exec-btn bt-exec-btn--odd' onClick={() => executeBulkTrade('odd')} disabled={executing}>
                            {executing ? '...' : 'BULK ODD'}
                        </button>
                    </div>
                )}
                {tradeType === 'rise_fall' && (
                    <div className='bt-btn-row'>
                        <button className='bt-exec-btn bt-exec-btn--rise' onClick={() => executeBulkTrade('rise')} disabled={executing}>
                            {executing ? '...' : 'BULK RISE'}
                        </button>
                        <button className='bt-exec-btn bt-exec-btn--fall' onClick={() => executeBulkTrade('fall')} disabled={executing}>
                            {executing ? '...' : 'BULK FALL'}
                        </button>
                    </div>
                )}
                {tradeType === 'matches_differs' && (
                    <div className='bt-btn-row'>
                        <button className='bt-exec-btn bt-exec-btn--matches' onClick={() => executeBulkTrade('matches')} disabled={executing}>
                            {executing ? '...' : `BULK MATCH ${prediction}`}
                        </button>
                        <button className='bt-exec-btn bt-exec-btn--differs' onClick={() => executeBulkTrade('differs')} disabled={executing}>
                            {executing ? '...' : `BULK DIFFER ${prediction}`}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );

    // ── RESULTS & ANALYTICS PANEL ──
    const renderResults = () => {
        const totalProfit = trades.reduce((sum, t) => sum + t.profit, 0);
        const wins = trades.filter(t => t.status === 'won').length;
        const winRate = trades.length ? ((wins / trades.length) * 100).toFixed(1) : '0';

        return (
            <div className='bt-results-panel'>
                <div className='bt-results-header'>
                    <div className='bt-results-tabs'>
                        <button className={resultsTab === 'transactions' ? 'active' : ''} onClick={() => setResultsTab('transactions')}>
                            Transactions
                        </button>
                        <button className={resultsTab === 'analytics' ? 'active' : ''} onClick={() => setResultsTab('analytics')}>
                            Analytics & Insights
                        </button>
                    </div>
                    <button className='bt-clear-btn' onClick={() => setTrades([])}>Clear Storage</button>
                </div>

                {resultsTab === 'transactions' ? (
                    <div className='bt-table-container'>
                        <table className='bt-trade-table'>
                            <thead>
                                <tr>
                                    <th>Time</th>
                                    <th>Type</th>
                                    <th>Symbol</th>
                                    <th>Stake</th>
                                    <th>Entry</th>
                                    <th>Exit</th>
                                    <th>Profit/Loss</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {trades.map(trade => (
                                    <tr key={trade.id} className={`status-${trade.status}`}>
                                        <td>{new Date(trade.time).toLocaleTimeString()}</td>
                                        <td>{trade.type}</td>
                                        <td>{trade.symbol}</td>
                                        <td>{trade.stake}</td>
                                        <td>{trade.entry}</td>
                                        <td>{trade.exit || '—'}</td>
                                        <td className={trade.profit > 0 ? 'txt-profit' : (trade.profit < 0 ? 'txt-loss' : '')}>
                                            {trade.profit > 0 ? `+${trade.profit.toFixed(2)}` : trade.profit.toFixed(2)}
                                        </td>
                                        <td>
                                            <span className={`bt-status-pill bt-status-pill--${trade.status}`}>
                                                {trade.status.toUpperCase()}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                                {!trades.length && <tr><td colSpan={8} align='center'>No bulk orders placed yet.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className='bt-analytics-view'>
                        <div className='bt-stats-grid'>
                            <div className='bt-stat-card'>
                                <label>Total Net Profit</label>
                                <span className={totalProfit >= 0 ? 'txt-profit' : 'txt-loss'}>
                                    ${totalProfit.toFixed(2)}
                                </span>
                            </div>
                            <div className='bt-stat-card'>
                                <label>Win Rate</label>
                                <span>{winRate}%</span>
                            </div>
                            <div className='bt-stat-card'>
                                <label>Total Trades</label>
                                <span>{trades.length}</span>
                            </div>
                            <div className='bt-stat-card'>
                                <label>Sessions Active</label>
                                <span>1</span>
                            </div>
                        </div>
                        <div className='bt-insights'>
                             <h4>💡 Session Insights</h4>
                             <p>You are performing best on {tradeType.replace('_', ' ')} with a win rate of {winRate}%.</p>
                             <div className='bt-spark-chart'>
                                {trades.slice(0, 20).reverse().map((t, idx) => (
                                    <div 
                                        key={idx} 
                                        className={`bt-spark-bar ${t.status}`}
                                        style={{ height: `${Math.abs(t.profit) * 100}%` }}
                                    />
                                ))}
                             </div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    // ── DIGIT ANALYSIS ───────────────────────────────────────────────────────
    const renderDigitAnalysis = () => (
        <div className='bt-analysis bt-analysis--digits'>
            <div className='bt-analysis__title'>
                <span>Digit Distribution</span>
                <span className='bt-analysis__subtitle'>Last {digitsWindow.length} ticks</span>
            </div>
            
            <div className='bt-dc-grid'>
                {DIGITS.map(d => {
                    const pct       = stats?.pct[d]  ?? 0;
                    const freq      = stats?.freq[d] ?? 0;
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
                            onClick={() => triggerPopup({ 
                                id: `digit-${d}`, 
                                title: `Digit ${d}`, 
                                value: `${pct.toFixed(2)}%`, 
                                extra: `${freq} counts` 
                            })}
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
                            {renderPopupUI(`digit-${d}`)}
                        </div>
                    );
                })}
            </div>

            <div className='bt-trail'>
                <div className='bt-trail__label'>Most Recent Digits (Newest First)</div>
                <div className='bt-trail__row'>
                    {[...digitsWindow].reverse().slice(0, 50).map((d, i) => {
                         const realIdx = digitsWindow.length - 1 - i;
                         const p = priceWindow[realIdx];
                         return (
                            <span
                                key={i}
                                className={`bt-trail__pill ${
                                    d >= 5 ? 'bt-trail__pill--high' : 'bt-trail__pill--low'
                                } ${i === 0 ? 'bt-trail__pill--latest' : ''}`}
                                onClick={() => triggerPopup({
                                    id: `trail-${i}`,
                                    title: `Digit ${d}`,
                                    value: `Price: ${p?.toFixed(pip) ?? '—'}`,
                                    extra: d >= 5 ? 'Prediction: Over' : 'Prediction: Under'
                                })}
                            >
                                {d}
                                {renderPopupUI(`trail-${i}`)}
                            </span>
                         );
                    })}
                </div>
            </div>
        </div>
    );

    // ── EVEN / ODD ───────────────────────────────────────────────────────────
    const renderEvenOdd = () => (
        <div className='bt-analysis bt-analysis--eo'>
            <div className='bt-analysis__title'>
                <span>Even / Odd Distribution</span>
                <span className='bt-analysis__subtitle'>Last {digitsWindow.length} ticks</span>
            </div>

            <div className='bt-eo-bars'>
                <div className='bt-eo-bar-row' onClick={() => triggerPopup({ 
                    id: 'even', 
                    title: 'Even Distribution', 
                    value: `${(stats?.evenPct ?? 0).toFixed(2)}%`, 
                    extra: `${stats?.evenCount} ticks total` 
                })}>
                    <span className='bt-eo-bar-row__label'>Even</span>
                    <div className='bt-eo-bar-row__track'>
                        <div
                            className='bt-eo-bar-row__fill bt-eo-bar-row__fill--even'
                            style={{ width: `${stats?.evenPct ?? 0}%` }}
                        />
                    </div>
                    <span className='bt-eo-bar-row__pct'>{(stats?.evenPct ?? 0).toFixed(1)}%</span>
                    {renderPopupUI('even')}
                </div>
                <div className='bt-eo-bar-row' onClick={() => triggerPopup({ 
                    id: 'odd', 
                    title: 'Odd Distribution', 
                    value: `${(stats?.oddPct ?? 0).toFixed(2)}%`, 
                    extra: `${stats?.oddCount} ticks total` 
                })}>
                    <span className='bt-eo-bar-row__label'>Odd</span>
                    <div className='bt-eo-bar-row__track'>
                        <div
                            className='bt-eo-bar-row__fill bt-eo-bar-row__fill--odd'
                            style={{ width: `${stats?.oddPct ?? 0}%` }}
                        />
                    </div>
                    <span className='bt-eo-bar-row__pct'>{(stats?.oddPct ?? 0).toFixed(1)}%</span>
                    {renderPopupUI('odd')}
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
                <div className='bt-trail__label'>Pattern Streak (Newest First)</div>
                <div className='bt-trail__row'>
                    {[...digitsWindow].reverse().slice(0, 50).map((d, i) => {
                        const realIdx = digitsWindow.length - 1 - i;
                        const p = priceWindow[realIdx];
                        return (
                            <span
                                key={i}
                                className={`bt-trail__pill ${d % 2 === 0 ? 'bt-trail__pill--even' : 'bt-trail__pill--odd'} ${i === 0 ? 'bt-trail__pill--latest' : ''}`}
                                onClick={() => triggerPopup({
                                    id: `eo-trail-${i}`,
                                    title: d % 2 === 0 ? 'Even Digit' : 'Odd Digit',
                                    value: `Price: ${p?.toFixed(pip) ?? '—'}`,
                                    extra: `Digit Value: ${d}`
                                })}
                            >
                                {d % 2 === 0 ? 'E' : 'O'}
                                {renderPopupUI(`eo-trail-${i}`)}
                            </span>
                        );
                    })}
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
                <div className='bt-eo-bar-row' onClick={() => triggerPopup({ 
                    id: 'rise', 
                    title: 'Market Rise', 
                    value: `${(stats?.risePct ?? 0).toFixed(2)}%`, 
                    extra: `${stats?.rises} momentum ticks` 
                })}>
                    <span className='bt-eo-bar-row__label'>🔼 Rise</span>
                    <div className='bt-eo-bar-row__track'>
                        <div
                            className='bt-eo-bar-row__fill bt-eo-bar-row__fill--rise'
                            style={{ width: `${stats?.risePct ?? 0}%` }}
                        />
                    </div>
                    <span className='bt-eo-bar-row__pct'>{(stats?.risePct ?? 0).toFixed(1)}%</span>
                    {renderPopupUI('rise')}
                </div>
                <div className='bt-eo-bar-row' onClick={() => triggerPopup({ 
                    id: 'fall', 
                    title: 'Market Fall', 
                    value: `${(stats?.fallPct ?? 0).toFixed(2)}%`, 
                    extra: `${stats?.falls} momentum ticks` 
                })}>
                    <span className='bt-eo-bar-row__label'>🔽 Fall</span>
                    <div className='bt-eo-bar-row__track'>
                        <div
                            className='bt-eo-bar-row__fill bt-eo-bar-row__fill--fall'
                            style={{ width: `${stats?.fallPct ?? 0}%` }}
                        />
                    </div>
                    <span className='bt-eo-bar-row__pct'>{(stats?.fallPct ?? 0).toFixed(1)}%</span>
                    {renderPopupUI('fall')}
                </div>
            </div>

            <div className='bt-trail'>
                <div className='bt-trail__label'>Tick Direction (Newest First)</div>
                <div className='bt-trail__row'>
                    {[...priceWindow].reverse().slice(0, 50).map((p, i, arr) => {
                        const next = arr[i + 1];
                        if (next === undefined) return null;
                        const isRise = p > next;
                        const diff = p - next;
                        const diffPct = (diff / next) * 100;

                        return (
                            <span
                                key={i}
                                className={`bt-trail__pill ${isRise ? 'bt-trail__pill--rise' : 'bt-trail__pill--fall'} ${i === 0 ? 'bt-trail__pill--latest' : ''}`}
                                onClick={() => triggerPopup({
                                    id: `rf-${i}`,
                                    title: isRise ? '🔼 Rise Momentum' : '🔽 Fall Momentum',
                                    value: `Price: ${p.toFixed(pip)}`,
                                    extra: `Change: ${diff > 0 ? '+' : ''}${diff.toFixed(pip)} (${diffPct.toFixed(4)}%)`
                                })}
                                style={{ position: 'relative' }}
                            >
                                {isRise ? '▲' : '▼'}
                                {renderPopupUI(`rf-${i}`)}
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
        if (status === 'connecting') return <div className='bt-banner bt-banner--info'>⟳ Connecting…</div>;
        return <div className='bt-banner bt-banner--ok'>● Real-Time Feed Active</div>;
    };

    return (
        <div className='bt-page'>
            <div className='bt-controls'>
                <div className='bt-inner'>
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
            </div>

            <div className='bt-type-tabs'>
                <div className='bt-inner'>
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
            </div>

            <div className='bt-type-desc'>
                <div className='bt-inner'>
                    {tradeTypeInfo.desc}
                </div>
            </div>

            <div className='bt-content'>
                <div className='bt-inner'>
                    {loading ? (
                        <div className='bt-loading'>
                            <div className='bt-loading__spinner' />
                            <span>Synchronizing Intelligence Subsystems…</span>
                        </div>
                    ) : (
                        <>
                            {(tradeType === 'over_under' || tradeType === 'matches_differs') && renderDigitAnalysis()}
                            {tradeType === 'even_odd'   && renderEvenOdd()}
                            {tradeType === 'rise_fall'  && renderRiseFall()}
                            
                            {/* ── New Trading Interface Sections ── */}
                            {renderConfig()}
                            {renderResults()}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
});

export default BulkTradingPage;
