import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import { observer as globalObserver } from '../../external/bot-skeleton/utils/observer';
import DBot from '../../external/bot-skeleton/scratch/dbot';
import { updateScannerBotXML } from './utils/xml-engine';
import './scanner.scss';

// ─── Constants ──────────────────────────────────────────────────────────────
const SCAN_SYMBOLS = [
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

const WINDOW_SIZE = 1000;

// High-Performance XML Template with IDs for targeting
const TEMPLATE_XML = `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <block type="trade_definition" id="trade_def_main" deletable="false" x="0" y="60">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" id="market_id_001" deletable="false" movable="false">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SUBMARKET_LIST">random_index</field>
        <field name="SYMBOL_LIST">1HZ10V</field>
        <next>
          <block type="trade_definition_tradetype" id="type_id_001" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">digits</field>
            <field name="TRADETYPE_LIST">overunder</field>
            <next>
              <block type="trade_definition_contracttype" id="contract_id_001" deletable="false" movable="false">
                <field name="TYPE_LIST">both</field>
                <next>
                  <block type="trade_definition_candleinterval" id="interval_id_001" deletable="false" movable="false">
                    <field name="CANDLEINTERVAL_LIST">60</field>
                    <next>
                      <block type="trade_definition_restartbuysell" id="restart_id_001" deletable="false" movable="false">
                        <field name="TIME_MACHINE_ENABLED">FALSE</field>
                        <next>
                          <block type="trade_definition_restartonerror" id="onerror_id_001" deletable="false" movable="false">
                            <field name="RESTARTONERROR">TRUE</field>
                          </block>
                        </next>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
    <statement name="SUBMARKET">
      <block type="trade_definition_tradeoptions" id="options_id_001">
        <mutation xmlns="http://www.w3.org/1999/xhtml" has_first_barrier="false" has_second_barrier="false" has_prediction="true"></mutation>
        <field name="DURATIONTYPE_LIST">t</field>
        <value name="DURATION">
          <shadow type="math_number_positive" id="dur_id_001">
            <field name="NUM">1</field>
          </shadow>
        </value>
        <value name="AMOUNT">
          <shadow type="math_number_positive" id="amount_id_001">
            <field name="NUM">0.35</field>
          </shadow>
        </value>
        <value name="PREDICTION">
          <shadow type="math_number_positive" id="predict_id_001">
            <field name="NUM">1</field>
          </shadow>
        </value>
      </block>
    </statement>
  </block>
  <block type="before_purchase" id="before_id_001" deletable="false" x="0" y="665">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="purchase" id="buy_id_001">
        <field name="PURCHASE_LIST">DIGITOVER</field>
      </block>
    </statement>
  </block>
  <block type="after_purchase" id="after_id_001" x="714" y="292">
    <statement name="AFTERPURCHASE_STACK">
      <block type="trade_again" id="again_id_001"></block>
    </statement>
  </block>
</xml>`;

interface IMarketData {
    symbol: string;
    prices: number[];
    digits: number[];
    pip_size: number;
    last_price: number;
    last_update: number;
}

interface ISignal {
    symbol: string;
    type: 'OVER' | 'UNDER' | 'NONE';
    prediction: number;
    confidence: number;
    reason: string;
}

const getDigit = (price: number, pip: number) => {
    if (price === undefined || isNaN(price)) return 0;
    const s = price.toFixed(pip);
    return Number(s[s.length - 1]);
};

const AIScannerPage: React.FC = observer((): JSX.Element => {
    const navigate = useNavigate();
    const [marketStats, setMarketStats] = useState<Record<string, IMarketData>>({});
    const [loading, setLoading] = useState(true);
    const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
    const [selectedSignal, setSelectedSignal] = useState<ISignal | null>(null);
    
    const [stake, setStake] = useState('0.35');
    const [martingale, setMartingale] = useState('2.0');
    const [takeProfit, setTakeProfit] = useState('10');
    const [stopLoss, setStopLoss] = useState('10');

    const wsRef = useRef<WebSocket | null>(null);
    const destroyed = useRef(false);

    useEffect(() => {
        const initialStats: Record<string, IMarketData> = {};
        SCAN_SYMBOLS.forEach(s => {
            initialStats[s.symbol] = {
                symbol: s.symbol, prices: [], digits: [], pip_size: s.pip, last_price: 0, last_update: Date.now()
            };
        });
        setMarketStats(initialStats);
    }, []);

    useEffect(() => {
        let wsUrl: string | null = null;
        const connect = async () => {
            if (destroyed.current) return;
            setWsStatus('connecting');
            try {
                const authInfo = OAuthTokenExchangeService.getAuthInfo();
                if (!authInfo?.access_token) return;
                wsUrl = await DerivWSAccountsService.getAuthenticatedWebSocketURL(authInfo.access_token);
                const ws = new WebSocket(wsUrl);
                wsRef.current = ws;
                ws.onopen = () => {
                    setWsStatus('connected');
                    SCAN_SYMBOLS.forEach(s => {
                        ws.send(JSON.stringify({
                            ticks_history: s.symbol,
                            count: WINDOW_SIZE, end: 'latest', style: 'ticks', subscribe: 1, req_id: 2002
                        }));
                    });
                };
                ws.onmessage = (event) => {
                    if (destroyed.current) return;
                    const msg = JSON.parse(event.data);
                    const { msg_type } = msg;

                    if (msg_type === 'history' && msg.req_id === 2002) {
                        const sym = msg.echo_req.ticks_history;
                        const prices = (msg.history?.prices ?? []).map(Number);
                        const pip = Number(msg.pip_size ?? 2);
                        setMarketStats(prev => ({
                            ...prev,
                            [sym]: { 
                                ...prev[sym], prices, 
                                digits: prices.map((p: number) => getDigit(p, pip)), 
                                pip_size: pip, last_price: prices[prices.length - 1] || 0,
                                last_update: Date.now() 
                            }
                        }));
                        setLoading(false);
                    }
                    if (msg_type === 'tick') {
                        const t = msg.tick;
                        const sym = t.symbol;
                        const quote = Number(t.quote);
                        const pip = Number(t.pip_size ?? 2);
                        const digit = getDigit(quote, pip);
                        setMarketStats(prev => {
                            const current = prev[sym];
                            if (!current) return prev;
                            return {
                                ...prev,
                                [sym]: { 
                                    ...current, 
                                    prices: [...current.prices, quote].slice(-WINDOW_SIZE),
                                    digits: [...current.digits, digit].slice(-WINDOW_SIZE),
                                    pip_size: pip, last_price: quote, last_update: Date.now() 
                                }
                            };
                        });
                    }
                };
                ws.onclose = () => { if (!destroyed.current) setTimeout(connect, 3000); };
            } catch (e) { setWsStatus('error'); }
        };
        connect();
        return () => { destroyed.current = true; wsRef.current?.close(); };
    }, []);

    const handleLaunchBot = useCallback(() => {
        if (!selectedSignal) return;
        const adaptiveXml = updateScannerBotXML(TEMPLATE_XML, {
            symbol: selectedSignal.symbol,
            stake: stake,
            prediction: selectedSignal.prediction,
            martingale: martingale,
            takeProfit,
            stopLoss
        });

        try {
            const workspace = (window.Blockly as any)?.derivWorkspace;
            if (!workspace) return;
            
            const dom = window.Blockly.utils.xml.textToDom(adaptiveXml);
            workspace.clear();
            window.Blockly.Xml.domToWorkspace(dom, workspace);
            
            globalObserver.emit('ui.log.info', `[AI Scanner] Launching DSS Engine for ${selectedSignal.symbol}...`);
            globalObserver.emit('ui.log.info', `[DSS] Recovery: ${selectedSignal.type} ${selectedSignal.prediction}`);
            
            setTimeout(() => { DBot.runBot(); navigate('/'); }, 500);
        } catch (e: any) { console.error('Bot launch failed:', e); }
    }, [selectedSignal, stake, martingale, takeProfit, stopLoss, navigate]);

    const signals = useMemo(() => {
        const results: ISignal[] = [];
        Object.values(marketStats).forEach(data => {
            if (data.digits.length < 100) return;
            const freq: Record<number, number> = {};
            data.digits.forEach(d => { freq[d] = (freq[d] || 0) + 1; });
            const total = data.digits.length;
            const pcts = [0,1,2,3,4,5,6,7,8,9].map(d => ({ digit: d, pct: ((freq[d] || 0) / total) * 100 }));
            
            const lowDigits = pcts.filter(p => p.digit <= 1).reduce((a,b) => a + b.pct, 0); // 0, 1
            const highDigits = pcts.filter(p => p.digit >= 8).reduce((a,b) => a + b.pct, 0); // 8, 9

            if (lowDigits < 15) {
                results.push({
                    symbol: data.symbol, type: 'OVER', prediction: 1,
                    confidence: Math.round(Math.min(100, (20 - lowDigits) * 10)),
                    reason: `Low density 0-1 digits (${lowDigits.toFixed(1)}%)`
                });
            } else if (highDigits < 15) {
                results.push({
                    symbol: data.symbol, type: 'UNDER', prediction: 8,
                    confidence: Math.round(Math.min(100, (20 - highDigits) * 10)),
                    reason: `Low density 8-9 digits (${highDigits.toFixed(1)}%)`
                });
            }
        });
        return results.sort((a,b) => b.confidence - a.confidence);
    }, [marketStats]);

    return (
        <div className="dss-scanner dss-scanner--full">
            <div className="dss-scanner__header">
                <div className="dss-scanner__title">
                    <h2>Deriv Smart Scanner</h2>
                    <div className={`dss-status dss-status--${wsStatus}`}>
                        {wsStatus === 'connected' ? '● Intelligence Active' : '○ Synchronizing...'}
                    </div>
                </div>
                <div className="dss-scanner__summary">
                    {loading ? 'Initializing Matrix...' : `Analysis: Over 1 / Under 8 • Markets: ${SCAN_SYMBOLS.length}`}
                </div>
            </div>

            <div className="dss-grid">
                {SCAN_SYMBOLS.map(s => {
                    const data = marketStats[s.symbol];
                    const signal = signals.find(sig => sig.symbol === s.symbol);
                    return (
                        <div key={s.symbol} className={`dss-card ${signal ? 'dss-card--has-signal' : 'dss-card--scanning'}`}>
                            <div className="dss-card__market">
                                <div className="dss-card__market-left">
                                    <span className="dss-card__name">{s.name}</span>
                                    <span className="dss-card__symbol">{s.symbol}</span>
                                </div>
                                <div className="dss-card__market-right">
                                    <span className="dss-price">{data?.last_price?.toFixed(data?.pip_size || 2)}</span>
                                </div>
                            </div>
                            <div className="dss-card__visual">
                                <div className="dss-distribution">
                                    {[0,1,2,3,4,5,6,7,8,9].map(d => {
                                        const count = data?.digits.filter(x => x === d).length || 0;
                                        const pct = data?.digits.length ? (count / data.digits.length) * 100 : 0;
                                        const deviation = pct - 10;
                                        return (
                                            <div key={d} className="dss-dist-bar">
                                                <div 
                                                    className={`dss-dist-fill ${deviation > 3 ? 'high' : (deviation < -3 ? 'low' : '')}`}
                                                    style={{ height: `${Math.min(pct * 3.5, 100)}%` }}
                                                >
                                                    <span className="pct-text">{pct.toFixed(0)}%</span>
                                                </div>
                                                <span className="dss-dist-label">{d}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                            {signal ? (
                                <div className="dss-signal animated pulse">
                                    <div className="dss-signal__type">
                                        <span className="label">RECOVERY DIGIT:</span>
                                        <span className={`value ${signal.type.toLowerCase()}`}>{signal.type} {signal.prediction}</span>
                                    </div>
                                    <div className="dss-signal__confidence">
                                        <div className="conf-bar"><div className="conf-fill" style={{ width: `${signal.confidence}%` }} /></div>
                                        <span className="conf-text">{signal.confidence}% Confidence</span>
                                    </div>
                                    <button className="dss-trade-btn" onClick={() => setSelectedSignal(signal)}>LOAD & RUN BOT</button>
                                </div>
                            ) : (
                                <div className="dss-no-signal">
                                    <div className="dss-search-loader" />
                                    <span>Hunting for DSS Bias...</span>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {selectedSignal && (
                <div className="dss-modal-overlay">
                    <div className="dss-modal">
                        <div className="dss-modal__header">
                            <h3>Initialise AI Strategy</h3>
                            <button onClick={() => setSelectedSignal(null)}>×</button>
                        </div>
                        <div className="dss-modal__body">
                            <div className="dss-modal__signal-info">
                                <span className="market">{selectedSignal.symbol}</span>
                                <span className={`type ${selectedSignal.type.toLowerCase()}`}>{selectedSignal.type} {selectedSignal.prediction}</span>
                            </div>
                            <div className="dss-form-grid">
                                <div className="dss-input-group">
                                    <label>Base Stake (USD)</label>
                                    <input type="number" step="0.1" value={stake} onChange={e => setStake(e.target.value)} />
                                </div>
                                <div className="dss-input-group">
                                    <label>Martingale Level</label>
                                    <input type="number" step="0.1" value={martingale} onChange={e => setMartingale(e.target.value)} />
                                </div>
                                <div className="dss-input-group">
                                    <label>Take Profit (USD)</label>
                                    <input type="number" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} />
                                </div>
                                <div className="dss-input-group">
                                    <label>Stop Loss (USD)</label>
                                    <input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} />
                                </div>
                            </div>
                        </div>
                        <div className="dss-modal__footer">
                            <button className="cancel-btn" onClick={() => setSelectedSignal(null)}>Cancel</button>
                            <button className="launch-btn" onClick={handleLaunchBot}>LOAD & RUN STRATEGY →</button>
                        </div>
                    </div>
                </div>
            )}
            
            {loading && (
                <div className="dss-loading-overlay">
                    <div className="dss-spinner" />
                    <p>Priming DSS Intelligence... Synching 10 Markets</p>
                </div>
            )}
        </div>
    );
});

export default AIScannerPage;
