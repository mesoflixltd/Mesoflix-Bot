import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Localize } from '@deriv-com/translations';
import './dcircles.scss';

type TSymbol = {
    symbol: string;
    display_name: string;
};
type TActiveSymbolItem = {
    symbol: string;
    display_name?: string;
};

const REQ_IDS = {
    ACTIVE_SYMBOLS: 1001,
    TICKS_HISTORY: 1002,
    TICKS_SUBSCRIBE: 1003,
} as const;

/** Fallback volatile index markets shown when the WS is unavailable */
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

/** Seed a repeatable-looking digit distribution for offline preview */
const seedDigitWindow = (): number[] => {
    const weights = [0.11, 0.09, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10];
    const result: number[] = [];
    let total = 0;
    weights.forEach((w, i) => {
        const n = Math.round(w * 1000);
        total += n;
        for (let j = 0; j < n; j++) result.push(i);
    });
    // pad/trim to exactly 1000
    while (result.length < 1000) result.push(Math.floor(Math.random() * 10));
    return result.slice(0, 1000).sort(() => Math.random() - 0.5);
};

const getLastDigit = (value: number | string) => {
    const normalized = String(value).replace('.', '');
    const lastChar = normalized[normalized.length - 1];
    const digit = Number(lastChar);
    return Number.isFinite(digit) ? digit : 0;
};

const DCircles = observer(() => {
    const wsRef = useRef<WebSocket | null>(null);
    const tickSubscriptionIdRef = useRef<string | null>(null);
    const selectedSymbolRef = useRef<string>('');

    const [symbols, setSymbols] = useState<TSymbol[]>(FALLBACK_SYMBOLS);
    const [selectedSymbol, setSelectedSymbol] = useState('R_10');
    const [digitsWindow, setDigitsWindow] = useState<number[]>(seedDigitWindow);
    const [isLoading, setIsLoading] = useState(false); // start false so circles show immediately
    const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'closed' | 'error'>(
        'connecting'
    );

    selectedSymbolRef.current = selectedSymbol;

    const sendMessage = useCallback((payload: Record<string, unknown>) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(payload));
        }
    }, []);

    const subscribeToTicks = useCallback(
        (symbol: string) => {
            if (!symbol) return;

            if (tickSubscriptionIdRef.current) {
                sendMessage({ forget: tickSubscriptionIdRef.current });
                tickSubscriptionIdRef.current = null;
            }

            sendMessage({
                ticks_history: symbol,
                end: 'latest',
                count: 1000,
                style: 'ticks',
                req_id: REQ_IDS.TICKS_HISTORY,
            });

            sendMessage({
                ticks: symbol,
                subscribe: 1,
                req_id: REQ_IDS.TICKS_SUBSCRIBE,
            });
        },
        [sendMessage]
    );

    useEffect(() => {
        // Correct Deriv public WebSocket endpoint
        const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1');
        wsRef.current = ws;
        setConnectionStatus('connecting');

        ws.onopen = () => {
            setConnectionStatus('connected');
            sendMessage({
                active_symbols: 'brief',
                product_type: 'basic',
                req_id: REQ_IDS.ACTIVE_SYMBOLS,
            });
        };

        ws.onmessage = event => {
            try {
                const message = JSON.parse(event.data);
                const { msg_type, req_id } = message;

                if (msg_type === 'active_symbols' && req_id === REQ_IDS.ACTIVE_SYMBOLS) {
                    const raw: TActiveSymbolItem[] = message.active_symbols || [];
                    const filtered = raw.filter(
                        item =>
                            typeof item.symbol === 'string' &&
                            /^(R_|1HZ)/.test(item.symbol) // only volatile indices
                    );

                    const fetchedSymbols: TSymbol[] =
                        filtered.length > 0
                            ? filtered
                                  .map(item => ({
                                      symbol: item.symbol,
                                      display_name: item.display_name || item.symbol,
                                  }))
                                  .sort((a, b) => a.display_name.localeCompare(b.display_name))
                            : FALLBACK_SYMBOLS;

                    setSymbols(fetchedSymbols);

                    const defaultSymbol =
                        fetchedSymbols.find(item => item.symbol === selectedSymbolRef.current)?.symbol ||
                        fetchedSymbols.find(item => item.symbol === 'R_10')?.symbol ||
                        fetchedSymbols[0]?.symbol;

                    if (defaultSymbol) {
                        selectedSymbolRef.current = defaultSymbol;
                        setSelectedSymbol(defaultSymbol);
                        subscribeToTicks(defaultSymbol);
                    }
                }

                if (msg_type === 'history' && req_id === REQ_IDS.TICKS_HISTORY) {
                    const prices: (number | string)[] = message.history?.prices || [];
                    if (prices.length > 0) {
                        const initialDigits = prices.map(price => getLastDigit(price)).slice(-1000);
                        setDigitsWindow(initialDigits);
                    }
                    setIsLoading(false);
                }

                if (msg_type === 'tick') {
                    if (message.tick?.subscription?.id) {
                        tickSubscriptionIdRef.current = message.tick.subscription.id;
                    }
                    const quote = message.tick?.quote;
                    if (typeof quote !== 'undefined') {
                        const digit = getLastDigit(quote);
                        setDigitsWindow(prev => [...prev.slice(-999), digit]);
                    }
                }
            } catch (error) {
                console.error('[DCircles] Failed to parse WS message:', error);
            }
        };

        ws.onerror = () => {
            setConnectionStatus('error');
            setIsLoading(false); // show fallback circles on error
        };

        ws.onclose = () => {
            setConnectionStatus('closed');
            setIsLoading(false); // show fallback circles when closed
        };

        return () => {
            if (tickSubscriptionIdRef.current && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ forget: tickSubscriptionIdRef.current }));
            }
            ws.close();
            wsRef.current = null;
            tickSubscriptionIdRef.current = null;
        };
    }, [sendMessage, subscribeToTicks]);

    const handleSymbolChange = (symbol: string) => {
        if (!symbol || symbol === selectedSymbolRef.current) return;
        selectedSymbolRef.current = symbol;
        setSelectedSymbol(symbol);
        setIsLoading(false); // keep showing old data while new data arrives
        subscribeToTicks(symbol);
    };

    const digitStats = useMemo(() => {
        const counts = Array.from({ length: 10 }, (_, digit) => ({ digit, count: 0, percentage: 0 }));
        if (!digitsWindow.length) return counts;

        digitsWindow.forEach(digit => {
            if (counts[digit]) counts[digit].count += 1;
        });

        return counts.map(item => ({
            ...item,
            percentage: Number(((item.count / digitsWindow.length) * 100).toFixed(2)),
        }));
    }, [digitsWindow]);

    const isOffline = connectionStatus === 'closed' || connectionStatus === 'error';

    return (
        <div className='dcircles-page'>
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

            {isOffline && (
                <div className='dcircles-page__offline-banner'>
                    <Localize i18n_default_text='Live data unavailable — showing cached digit distribution.' />
                </div>
            )}

            <div className='dcircles-page__controls'>
                <label htmlFor='dcircles-symbol'>
                    <Localize i18n_default_text='Market symbol' />
                </label>
                <select
                    id='dcircles-symbol'
                    value={selectedSymbol}
                    onChange={event => handleSymbolChange(event.target.value)}
                >
                    {symbols.map(symbol => (
                        <option key={symbol.symbol} value={symbol.symbol}>
                            {symbol.display_name}
                        </option>
                    ))}
                </select>
            </div>

            {isLoading ? (
                <div className='dcircles-page__loading'>
                    <span className='dcircles-page__spinner' />
                    <Localize i18n_default_text='Loading market ticks…' />
                </div>
            ) : (
                <div className='dcircles-grid'>
                    {digitStats.map(({ digit, count, percentage }) => (
                        <div key={digit} className='dcircles-card'>
                            <div className='dcircles-card__digit'>{digit}</div>
                            <div className='dcircles-card__meta'>
                                <span>{percentage}%</span>
                                <span>{count} ticks</span>
                            </div>
                            <div className='dcircles-card__bar'>
                                <div className='dcircles-card__bar-fill' style={{ width: `${percentage}%` }} />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
});

export default DCircles;
