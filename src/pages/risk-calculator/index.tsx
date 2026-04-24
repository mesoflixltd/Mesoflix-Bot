import React, { useState, useEffect, useMemo, useCallback } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { v4 as uuidv4 } from 'uuid';
import {
    LabelPairedChartMixedCaptionBoldIcon,
    LabelPairedMemoPadCaptionBoldIcon,
    LabelPairedCirclePlusCaptionRegularIcon,
    LabelPairedTrashCaptionRegularIcon,
    LabelPairedPenCaptionRegularIcon,
    LabelPairedCircleCheckCaptionRegularIcon,
    LabelPairedCircleExclamationCaptionRegularIcon,
} from '@deriv/quill-icons/LabelPaired';
import { Button, Text, useDevice } from '@deriv-com/ui';
import InputField from '@/components/shared_ui/input-field';
import { Localize, localize } from '@deriv-com/translations';
import './risk-calculator.scss';

// ── Types ──────────────────────────────────────────────────────────────────────
type TJournalEntry = {
    id: string;
    title: string;
    description: string;
    type: 'Journal' | 'Plan';
    createdAt: string;
    calcSnapshot?: string; // serialized calculator result
};

const MIN_STAKE = 0.35; // Deriv minimum stake

// ── Main Component ─────────────────────────────────────────────────────────────
const RiskCalculator = observer(() => {
    const { isDesktop } = useDevice();

    // ── Calculator state ───────────────────────────────────────────────────────
    const [balance,      setBalance]      = useState<string>('1000');
    const [target,       setTarget]       = useState<string>('1200');
    const [payoutPct,    setPayoutPct]    = useState<string>('95');
    const [stake,        setStake]        = useState<string>('0.35');
    const [sessionRuns,  setSessionRuns]  = useState<string>('3');

    // ── Journal state ──────────────────────────────────────────────────────────
    const [entries,      setEntries]      = useState<TJournalEntry[]>([]);
    const [isFormOpen,   setIsFormOpen]   = useState(false);
    const [editingEntry, setEditingEntry] = useState<TJournalEntry | null>(null);
    const [title,        setTitle]        = useState('');
    const [description,  setDescription]  = useState('');
    const [entryType,    setEntryType]    = useState<'Journal' | 'Plan'>('Journal');
    const [active_view,  setActiveView]   = useState<'calculator' | 'journal'>('calculator');

    // ── Persist journal ────────────────────────────────────────────────────────
    useEffect(() => {
        const saved = localStorage.getItem('mesoflix_trading_journal');
        if (saved) {
            try { setEntries(JSON.parse(saved)); } catch (_) { /* noop */ }
        }
    }, []);

    useEffect(() => {
        localStorage.setItem('mesoflix_trading_journal', JSON.stringify(entries));
    }, [entries]);

    // ── AI Engine calculations ─────────────────────────────────────────────────
    const calc = useMemo(() => {
        const b   = parseFloat(balance)   || 0;
        const tgt = parseFloat(target)    || 0;
        const pp  = parseFloat(payoutPct) || 95;
        const stk = Math.max(MIN_STAKE, parseFloat(stake) || MIN_STAKE);
        const runs = Math.max(1, parseInt(sessionRuns, 10) || 3);

        const profitNeeded   = Math.max(0, tgt - b);
        const profitPerTrade = stk * (pp / 100);            // profit on each winning trade
        const tradesNeeded   = profitPerTrade > 0
            ? Math.ceil(profitNeeded / profitPerTrade)
            : 0;
        const tradesPerRun   = Math.ceil(tradesNeeded / runs);
        const roiPercent     = b > 0 ? ((tgt - b) / b) * 100 : 0;
        const winRateNeeded  = tradesNeeded > 0
            ? (tradesNeeded / (tradesNeeded * 1.2)) * 100  // assumes ~20% loss buffer
            : 0;
        const maxDrawdownRisk = stk * tradesPerRun;         // worst-case loss per run
        const totalPayout     = stk + profitPerTrade;

        // Daily projection — simple linear at `runs` per day
        const daysNeeded = runs > 0 ? Math.ceil(tradesNeeded / (tradesPerRun * runs)) : 0;

        return {
            stk:             stk.toFixed(2),
            profitPerTrade:  profitPerTrade.toFixed(3),
            totalPayout:     totalPayout.toFixed(3),
            profitNeeded:    profitNeeded.toFixed(2),
            tradesNeeded,
            tradesPerRun,
            roiPercent:      roiPercent.toFixed(1),
            winRateNeeded:   winRateNeeded.toFixed(1),
            maxDrawdownRisk: maxDrawdownRisk.toFixed(2),
            daysNeeded,
            isViable:        stk >= MIN_STAKE && profitNeeded >= 0 && b > 0,
        };
    }, [balance, target, payoutPct, stake, sessionRuns]);

    // ── "Save to Journal" pre-fill with calculation snapshot ──────────────────
    const handleSaveCalcToJournal = useCallback(() => {
        const snap = [
            `Balance: $${balance}  →  Target: $${target}`,
            `Stake: $${calc.stk}  |  Payout: ${payoutPct}%  |  Profit/trade: $${calc.profitPerTrade}`,
            `Trades needed: ${calc.tradesNeeded}  |  Trades/run: ${calc.tradesPerRun}  |  Runs/session: ${sessionRuns}`,
            `ROI needed: ${calc.roiPercent}%  |  Est. days: ${calc.daysNeeded}`,
            `Max drawdown per run: $${calc.maxDrawdownRisk}`,
        ].join('\n');
        setTitle(`Target Plan — $${balance} → $${target}`);
        setDescription(snap);
        setEntryType('Plan');
        setIsFormOpen(true);
        setActiveView('journal');
    }, [balance, target, payoutPct, stake, sessionRuns, calc]);

    // ── Journal CRUD ───────────────────────────────────────────────────────────
    const handleSaveEntry = () => {
        if (!title.trim() || !description.trim()) return;
        if (editingEntry) {
            setEntries(prev => prev.map(e =>
                e.id === editingEntry.id ? { ...e, title, description, type: entryType } : e
            ));
            setEditingEntry(null);
        } else {
            setEntries(prev => [{
                id: uuidv4(), title, description, type: entryType,
                createdAt: new Date().toISOString(),
            }, ...prev]);
        }
        setTitle(''); setDescription(''); setIsFormOpen(false);
    };

    const handleDeleteEntry = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setEntries(prev => prev.filter(item => item.id !== id));
    };

    const handleEditEntry = (entry: TJournalEntry) => {
        setEditingEntry(entry);
        setTitle(entry.title);
        setDescription(entry.description);
        setEntryType(entry.type);
        setIsFormOpen(true);
        if (!isDesktop) setActiveView('journal');
    };

    // ── Render ─────────────────────────────────────────────────────────────────
    const renderCalculator = () => (
        <div className='rc-card'>
            <div className='rc-card__title'>
                <LabelPairedChartMixedCaptionBoldIcon width='22px' height='22px' fill='var(--brand-red-coral)' />
                AI Trading Calculator
            </div>

            <div className='rc-form'>
                {/* Row 1 */}
                <div className='rc-form__row'>
                    <div className='rc-form__field'>
                        <label>Account Balance ($)</label>
                        <input type='number' min='0' value={balance} onChange={e => setBalance(e.target.value)} />
                    </div>
                    <div className='rc-form__field'>
                        <label>Target Amount ($)</label>
                        <input type='number' min='0' value={target}  onChange={e => setTarget(e.target.value)} />
                    </div>
                </div>

                {/* Row 2 */}
                <div className='rc-form__row'>
                    <div className='rc-form__field'>
                        <label>Stake per Trade ($)</label>
                        <input
                            type='number' min={MIN_STAKE} step='0.01'
                            value={stake}
                            onChange={e => setStake(e.target.value)}
                        />
                        <span className='rc-form__hint'>Min: ${MIN_STAKE} (Deriv default)</span>
                    </div>
                    <div className='rc-form__field'>
                        <label>Payout per Trade (%)</label>
                        <input type='number' min='1' max='200' value={payoutPct} onChange={e => setPayoutPct(e.target.value)} />
                    </div>
                </div>

                {/* Row 3 */}
                <div className='rc-form__row rc-form__row--single'>
                    <div className='rc-form__field'>
                        <label>Runs per Session</label>
                        <input type='number' min='1' max='100' value={sessionRuns} onChange={e => setSessionRuns(e.target.value)} />
                        <span className='rc-form__hint'>How many rounds you plan per session</span>
                    </div>
                </div>
            </div>

            {/* AI Results Panel */}
            {calc.isViable ? (
                <div className='rc-results'>
                    <div className='rc-results__header'>
                        <span className='rc-results__badge'>AI Analysis</span>
                        <span className='rc-results__roi'>ROI needed: <strong>{calc.roiPercent}%</strong></span>
                    </div>

                    <div className='rc-results__grid'>
                        <div className='rc-stat rc-stat--primary'>
                            <div className='rc-stat__value'>{calc.tradesNeeded}</div>
                            <div className='rc-stat__label'>Total Trades Needed</div>
                        </div>
                        <div className='rc-stat rc-stat--accent'>
                            <div className='rc-stat__value'>{calc.tradesPerRun}</div>
                            <div className='rc-stat__label'>Trades per Run</div>
                        </div>
                        <div className='rc-stat'>
                            <div className='rc-stat__value'>${calc.profitPerTrade}</div>
                            <div className='rc-stat__label'>Profit per Win</div>
                        </div>
                        <div className='rc-stat'>
                            <div className='rc-stat__value'>${calc.profitNeeded}</div>
                            <div className='rc-stat__label'>Total Profit Needed</div>
                        </div>
                        <div className='rc-stat rc-stat--danger'>
                            <div className='rc-stat__value'>${calc.maxDrawdownRisk}</div>
                            <div className='rc-stat__label'>Max Risk / Run</div>
                        </div>
                        <div className='rc-stat'>
                            <div className='rc-stat__value'>{calc.daysNeeded}d</div>
                            <div className='rc-stat__label'>Est. Days at {sessionRuns} runs/day</div>
                        </div>
                    </div>

                    <div className='rc-results__summary'>
                        <p>
                            With a <strong>${calc.stk}</strong> stake at <strong>{payoutPct}%</strong> payout,
                            each win nets <strong>${calc.profitPerTrade}</strong>. You need
                            <strong> {calc.tradesNeeded} wins</strong> to reach your
                            target, split into <strong>{calc.tradesPerRun} trades per run</strong> across
                            <strong> {sessionRuns} runs per session</strong>.
                        </p>
                    </div>

                    <button className='rc-save-btn' onClick={handleSaveCalcToJournal}>
                        📓 Save to Journal as Trading Plan
                    </button>
                </div>
            ) : (
                <div className='rc-results rc-results--invalid'>
                    <p>⚠ Enter valid balance, target, and a stake ≥ ${MIN_STAKE} to see your AI analysis.</p>
                </div>
            )}
        </div>
    );

    const renderJournal = () => (
        <div className='rc-card rc-card--journal'>
            <div className='rc-card__title-row'>
                <div className='rc-card__title'>
                    <LabelPairedMemoPadCaptionBoldIcon width='22px' height='22px' fill='var(--brand-blue)' />
                    Trading Journal
                </div>
                <button className='rc-add-btn' onClick={() => { setIsFormOpen(!isFormOpen); if (isFormOpen) setEditingEntry(null); }}>
                    {isFormOpen ? '✕ Cancel' : '+ New Entry'}
                </button>
            </div>

            {/* Journal Form */}
            {isFormOpen && (
                <div className='rc-journal-form'>
                    <div className='rc-form__field'>
                        <label>Title / Trading Pair</label>
                        <input type='text' value={title} onChange={e => setTitle(e.target.value)} placeholder='e.g. Target Plan — R_50' />
                    </div>
                    <div className='rc-journal-form__types'>
                        {(['Journal', 'Plan'] as const).map(t => (
                            <label key={t} className={classNames('rc-type-btn', { 'rc-type-btn--active': entryType === t })}>
                                <input type='radio' name='entry-type' checked={entryType === t} onChange={() => setEntryType(t)} />
                                {t === 'Journal' ? '📒 Journal' : '📋 Trading Plan'}
                            </label>
                        ))}
                    </div>
                    <div className='rc-form__field'>
                        <label>Notes / Strategy</label>
                        <textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder='Write your strategy, results, or what happened in the trade...'
                            rows={5}
                        />
                    </div>
                    <button
                        className='rc-save-btn'
                        onClick={handleSaveEntry}
                        disabled={!title.trim() || !description.trim()}
                    >
                        {editingEntry ? '✏️ Update Entry' : '💾 Save Entry'}
                    </button>
                </div>
            )}

            {/* Journal List */}
            {!isFormOpen && (
                <div className='rc-journal-list'>
                    {entries.length === 0 ? (
                        <div className='rc-journal-empty'>
                            <LabelPairedCircleExclamationCaptionRegularIcon width='40px' height='40px' />
                            <strong>Your journal is empty</strong>
                            <span>Save a calculation above or add an entry manually.</span>
                        </div>
                    ) : (
                        entries.map(entry => (
                            <div key={entry.id} className='rc-journal-item' onClick={() => handleEditEntry(entry)}>
                                <div className='rc-journal-item__header'>
                                    <h3>{entry.title}</h3>
                                    <time>{new Date(entry.createdAt).toLocaleDateString()}</time>
                                </div>
                                <p>{entry.description.length > 180 ? entry.description.substring(0, 180) + '…' : entry.description}</p>
                                <div className='rc-journal-item__footer'>
                                    <span className={classNames('rc-tag', { 'rc-tag--plan': entry.type === 'Plan' })}>
                                        {entry.type === 'Plan' ? '📋 Plan' : '📒 Journal'}
                                    </span>
                                    <div className='rc-journal-item__actions'>
                                        <LabelPairedPenCaptionRegularIcon width='15px' height='15px' fill='var(--text-less-prominent)' />
                                        <LabelPairedTrashCaptionRegularIcon
                                            width='15px' height='15px' fill='var(--status-danger)'
                                            onClick={(e: React.MouseEvent) => handleDeleteEntry(entry.id, e)}
                                        />
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );

    return (
        <div className='risk-calculator-page'>
            {/* Header */}
            <div className='risk-calculator-page__header'>
                <div className='risk-calculator-page__header-title'>
                    <Text as='h1'>Deriv Risk Tools</Text>
                    {!isDesktop && (
                        <div className='risk-calculator-page__toggle'>
                            <button
                                className={classNames('toggle-btn', { 'toggle-btn--active': active_view === 'calculator' })}
                                onClick={() => setActiveView('calculator')}
                            >
                                <LabelPairedChartMixedCaptionBoldIcon width='16px' height='16px' fill={active_view === 'calculator' ? 'white' : 'var(--text-general)'} />
                                <span>{localize('Calculator')}</span>
                            </button>
                            <button
                                className={classNames('toggle-btn', { 'toggle-btn--active': active_view === 'journal' })}
                                onClick={() => setActiveView('journal')}
                            >
                                <LabelPairedMemoPadCaptionBoldIcon width='16px' height='16px' fill={active_view === 'journal' ? 'white' : 'var(--text-general)'} />
                                <span>{localize('Journal')}</span>
                            </button>
                        </div>
                    )}
                </div>
                <Text color='less-prominent'>
                    AI-powered trade planner — enter your balance, target &amp; stake to get your session plan.
                </Text>
            </div>

            {/* Scrollable content area */}
            <div className='risk-calculator-page__scroll-container'>
                <div className={classNames('risk-calculator-page__content', {
                    'risk-calculator-page__content--mobile-toggle': !isDesktop,
                })}>
                    {(isDesktop || active_view === 'calculator') && renderCalculator()}
                    {(isDesktop || active_view === 'journal')    && renderJournal()}
                </div>
            </div>
        </div>
    );
});

export default RiskCalculator;
