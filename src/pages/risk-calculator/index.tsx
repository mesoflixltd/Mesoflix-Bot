import React, { useState, useEffect, useMemo } from 'react';
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
    LabelPairedCircleExclamationCaptionRegularIcon
} from '@deriv/quill-icons/LabelPaired';
import { Button, Text, useDevice } from '@deriv-com/ui';
import InputField from '@/components/shared_ui/input-field';
import { Localize, localize } from '@deriv-com/translations';
import ThemedScrollbars from '@/components/shared_ui/themed-scrollbars';
import './risk-calculator.scss';

type TJournalEntry = {
    id: string;
    title: string;
    description: string;
    type: 'Journal' | 'Plan';
    createdAt: string;
};

const RiskCalculator = observer(() => {
    const { isDesktop } = useDevice();
    
    // Calculator State
    const [balance, setBalance] = useState<string>('1000');
    const [riskPercent, setRiskPercent] = useState<string>('1');
    const [payoutPercent, setPayoutPercent] = useState<string>('95');

    // Journal State
    const [entries, setEntries] = useState<TJournalEntry[]>([]);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingEntry, setEditingEntry] = useState<TJournalEntry | null>(null);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [entryType, setEntryType] = useState<'Journal' | 'Plan'>('Journal');

    const [active_view, setActiveView] = useState<'calculator' | 'journal'>('calculator');

    // Load initial data
    useEffect(() => {
        const saved = localStorage.getItem('mesoflix_trading_journal');
        if (saved) {
            try {
                setEntries(JSON.parse(saved));
            } catch (e) {
                console.error('Failed to load journal', e);
            }
        }
    }, []);

    // Save data when entries change
    useEffect(() => {
        localStorage.setItem('mesoflix_trading_journal', JSON.stringify(entries));
    }, [entries]);

    // Calculations
    const calculations = useMemo(() => {
        const b = parseFloat(balance) || 0;
        const r = parseFloat(riskPercent) || 0;
        const p = parseFloat(payoutPercent) || 0;

        const riskAmount = b * (r / 100);
        const stake = riskAmount; // In options, your stake is your risk
        const profit = stake * (p / 100);

        return {
            riskAmount: riskAmount.toFixed(2),
            recommendedStake: stake.toFixed(2),
            potentialProfit: profit.toFixed(2),
            totalPayout: (stake + profit).toFixed(2),
        };
    }, [balance, riskPercent, payoutPercent]);

    // Journal Handlers
    const handleSaveEntry = () => {
        if (!title.trim() || !description.trim()) return;

        if (editingEntry) {
            setEntries(prev => prev.map(e => e.id === editingEntry.id ? { ...e, title, description, type: entryType } : e));
            setEditingEntry(null);
        } else {
            const newEntry: TJournalEntry = {
                id: uuidv4(),
                title,
                description,
                type: entryType,
                createdAt: new Date().toISOString(),
            };
            setEntries(prev => [newEntry, ...prev]);
        }

        setTitle('');
        setDescription('');
        setIsFormOpen(false);
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

    return (
        <div className='risk-calculator-page'>
            <div className='risk-calculator-page__header'>
                <div className='risk-calculator-page__header-title'>
                    <Text as='h1'><Localize i18n_default_text='Deriv Risk Tools' /></Text>
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
                    <Localize i18n_default_text='Calculate per-trade stake and track your bot journey.' />
                </Text>
            </div>

            <div className='risk-calculator-page__scroll-container'>
                <ThemedScrollbars>
                    <div className={classNames('risk-calculator-page__content', { 'risk-calculator-page__content--mobile-toggle': !isDesktop })}>
                        {/* Left: Calculator */}
                        {(isDesktop || active_view === 'calculator') && (
                            <div className='card'>
                                <div className='card__title'>
                                    <LabelPairedChartMixedCaptionBoldIcon width='24px' height='24px' fill='var(--brand-red-coral)' />
                                    <Localize i18n_default_text='Stake Calculator' />
                                </div>
                                
                                <div className='calculator-form'>
                                    <InputField
                                        label={localize('Account Balance ($)')}
                                        value={balance}
                                        onChange={(e: any) => setBalance(e.target.value)}
                                        type='number'
                                    />
                                    <div className='calculator-form__row'>
                                        <InputField
                                            label={localize('Risk (%)')}
                                            value={riskPercent}
                                            onChange={(e: any) => setRiskPercent(e.target.value)}
                                            type='number'
                                        />
                                        <InputField
                                            label={localize('Market Payout (%)')}
                                            value={payoutPercent}
                                            onChange={(e: any) => setPayoutPercent(e.target.value)}
                                            type='number'
                                        />
                                    </div>

                                    <div className='calculator-form__results'>
                                        <div className='calculator-form__result-item'>
                                            <Text size='sm'><Localize i18n_default_text='Risk Amount' /></Text>
                                            <Text weight='bold'>${calculations.riskAmount}</Text>
                                        </div>
                                        <div className='calculator-form__result-item calculator-form__result-item--highlight'>
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <Text size='md' weight='bold' color='prominent'><Localize i18n_default_text='Recommended Stake' /></Text>
                                                <Text size='xxs' color='less-prominent'><Localize i18n_default_text='Based on your risk %' /></Text>
                                            </div>
                                            <Text size='lg' weight='bold' color='profit'>${calculations.recommendedStake}</Text>
                                        </div>
                                        <div className='calculator-form__result-item'>
                                            <Text size='sm'><Localize i18n_default_text='Potential Profit' /></Text>
                                            <Text color='profit'>+${calculations.potentialProfit}</Text>
                                        </div>
                                        <div className='calculator-form__result-item'>
                                            <Text size='sm'><Localize i18n_default_text='Total Payout' /></Text>
                                            <Text weight='bold'>${calculations.totalPayout}</Text>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Right: Journal */}
                        {(isDesktop || active_view === 'journal') && (
                            <div className='card journal-section'>
                                <div className='journal-section__header'>
                                    <div className='card__title'>
                                        <LabelPairedMemoPadCaptionBoldIcon width='24px' height='24px' fill='var(--brand-blue)' />
                                        <Localize i18n_default_text='Trading Journal' />
                                    </div>
                                    <Button 
                                        color='primary' 
                                        onClick={() => setIsFormOpen(!isFormOpen)}
                                    >
                                        {isFormOpen ? localize('Cancel') : (
                                            <>
                                                <LabelPairedCirclePlusCaptionRegularIcon width='16px' height='16px' fill='white' />
                                                <span style={{ marginLeft: '8px' }}>{localize('New Entry')}</span>
                                            </>
                                        )}
                                    </Button>
                                </div>

                                {isFormOpen ? (
                                    <div className='journal-form'>
                                        <InputField
                                            label={localize('Title / Trading Pair')}
                                            value={title}
                                            onChange={(e: any) => setTitle(e.target.value)}
                                        />
                                        <div style={{ display: 'flex', gap: '16px', margin: '8px 0' }}>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                                <input 
                                                    type='radio' 
                                                    name='type' 
                                                    checked={entryType === 'Journal'} 
                                                    onChange={() => setEntryType('Journal')} 
                                                />
                                                <Localize i18n_default_text='Journal' />
                                            </label>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                                <input 
                                                    type='radio' 
                                                    name='type' 
                                                    checked={entryType === 'Plan'} 
                                                    onChange={() => setEntryType('Plan')} 
                                                />
                                                <Localize i18n_default_text='Trading Plan' />
                                            </label>
                                        </div>
                                        <textarea
                                            placeholder={localize('Write your strategy, rules, or what happened in the trade...')}
                                            value={description}
                                            onChange={(e) => setDescription(e.target.value)}
                                        />
                                        <Button color='primary' onClick={handleSaveEntry} disabled={!title || !description}>
                                            <Localize i18n_default_text='Save Entry' />
                                        </Button>
                                    </div>
                                ) : (
                                    <div className='journal-section__list'>
                                        {entries.length === 0 ? (
                                            <div className='journal-section__empty'>
                                                <LabelPairedCircleExclamationCaptionRegularIcon width='48px' height='48px' />
                                                <Text weight='bold'><Localize i18n_default_text='Your journal is empty' /></Text>
                                                <Text size='sm'><Localize i18n_default_text='Start tracking your trades and plans today.' /></Text>
                                            </div>
                                        ) : (
                                            entries.map(entry => (
                                                <div key={entry.id} className='journal-section__item' onClick={() => handleEditEntry(entry)}>
                                                    <header>
                                                        <h3>{entry.title}</h3>
                                                        <time>{new Date(entry.createdAt).toLocaleDateString()}</time>
                                                    </header>
                                                    <p>{entry.description.length > 200 ? entry.description.substring(0, 200) + '...' : entry.description}</p>
                                                    <footer>
                                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                            {entry.type === 'Plan' ? 
                                                                <LabelPairedCircleCheckCaptionRegularIcon width='16px' height='16px' fill='var(--brand-blue)' /> :
                                                                <LabelPairedMemoPadCaptionBoldIcon width='16px' height='16px' fill='var(--text-less-prominent)' />
                                                            }
                                                            <Text size='xs' color='less-prominent'>{entry.type}</Text>
                                                        </div>
                                                        <div style={{ display: 'flex', gap: '12px' }}>
                                                            <LabelPairedPenCaptionRegularIcon width='16px' height='16px' fill='var(--text-less-prominent)' />
                                                            <LabelPairedTrashCaptionRegularIcon 
                                                                width='16px' 
                                                                height='16px' 
                                                                fill='var(--status-danger)' 
                                                                onClick={(e) => handleDeleteEntry(entry.id, e)}
                                                            />
                                                        </div>
                                                    </footer>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </ThemedScrollbars>
            </div>
        </div>
    );
});

export default RiskCalculator;
