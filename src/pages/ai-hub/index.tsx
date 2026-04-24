import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import BulkTradingPage from './bulk-trading';
import './ai-hub.scss';

// ─── Sub-page components ──────────────────────────────────────────────────────

const AIScannerPage = () => (
    <div className='aihub-subpage aihub-subpage--scanner'>
        <div className='aihub-subpage__hero'>
            <div className='aihub-subpage__hero-icon'>🔍</div>
            <h2>AI Scanner</h2>
            <p>Real-time pattern recognition across multiple markets. The scanner monitors digit distributions, streak patterns, and statistical anomalies to surface high-probability trade opportunities.</p>
            <div className='aihub-badge aihub-badge--live'>● Live Engine — Coming Soon</div>
        </div>

        <div className='aihub-features-grid'>
            <div className='aihub-feature-card'>
                <div className='aihub-feature-card__icon'>📊</div>
                <h3>Digit Bias Detection</h3>
                <p>Identifies digits that are statistically over or under-represented based on rolling window analysis.</p>
                <div className='aihub-feature-card__status aihub-feature-card__status--pending'>In Development</div>
            </div>
            <div className='aihub-feature-card'>
                <div className='aihub-feature-card__icon'>🔥</div>
                <h3>Hot Zone Alerts</h3>
                <p>Notifies you when a market enters a statistically significant run — even, odd, rise, or fall clusters.</p>
                <div className='aihub-feature-card__status aihub-feature-card__status--pending'>In Development</div>
            </div>
            <div className='aihub-feature-card'>
                <div className='aihub-feature-card__icon'>⚡</div>
                <h3>Momentum Signals</h3>
                <p>Tracks price velocity across synthetic indices to detect acceleration patterns before they peak.</p>
                <div className='aihub-feature-card__status aihub-feature-card__status--pending'>In Development</div>
            </div>
            <div className='aihub-feature-card'>
                <div className='aihub-feature-card__icon'>🎯</div>
                <h3>Entry Score</h3>
                <p>A 0–100 confidence score aggregated from all active signals, helping you decide when to trade.</p>
                <div className='aihub-feature-card__status aihub-feature-card__status--pending'>In Development</div>
            </div>
        </div>
    </div>
);

const BulkTradingPageTab = () => <BulkTradingPage />;

const UltimateTraderPage = () => (
    <div className='aihub-subpage aihub-subpage--ultimate'>
        <div className='aihub-subpage__hero'>
            <div className='aihub-subpage__hero-icon'>🏆</div>
            <h2>Ultimate Trader</h2>
            <p>The complete autonomous trading suite. Combines AI signals, bulk execution, and adaptive risk management into one command center. Set your goal and let it trade.</p>
            <div className='aihub-badge aihub-badge--pro'>★ Pro Feature — Coming Soon</div>
        </div>

        <div className='aihub-features-grid'>
            <div className='aihub-feature-card aihub-feature-card--gold'>
                <div className='aihub-feature-card__icon'>🧠</div>
                <h3>AI Autopilot</h3>
                <p>The system reads live market data, selects the optimal trade type, enters and exits automatically based on your pre-set risk profile.</p>
                <div className='aihub-feature-card__status aihub-feature-card__status--pro'>Pro</div>
            </div>
            <div className='aihub-feature-card aihub-feature-card--gold'>
                <div className='aihub-feature-card__icon'>🎯</div>
                <h3>Goal-Based Sessions</h3>
                <p>Set a profit target and a stop-loss. The engine runs until one is hit, then sends you a full session report.</p>
                <div className='aihub-feature-card__status aihub-feature-card__status--pro'>Pro</div>
            </div>
            <div className='aihub-feature-card aihub-feature-card--gold'>
                <div className='aihub-feature-card__icon'>📡</div>
                <h3>Live Strategy Feed</h3>
                <p>Receive strategy updates from Mesoflix's AI model trained on millions of synthetic index ticks.</p>
                <div className='aihub-feature-card__status aihub-feature-card__status--pro'>Pro</div>
            </div>
            <div className='aihub-feature-card aihub-feature-card--gold'>
                <div className='aihub-feature-card__icon'>📊</div>
                <h3>Performance Dashboard</h3>
                <p>A full session analytics panel — win rate, ROI, best hours, best markets, and equity curve.</p>
                <div className='aihub-feature-card__status aihub-feature-card__status--pro'>Pro</div>
            </div>
        </div>

        <div className='aihub-cta'>
            <div className='aihub-cta__text'>
                <h3>Be the First to Access</h3>
                <p>Ultimate Trader is currently in closed development. Join the waitlist to get early access when it launches.</p>
            </div>
            <a
                className='aihub-cta__btn'
                href='https://wa.me/254725666447?text=Hi!%20I%20want%20early%20access%20to%20the%20Mesoflix%20Ultimate%20Trader.'
                target='_blank'
                rel='noreferrer'
            >
                Join the Waitlist →
            </a>
        </div>
    </div>
);

// ─── Tab definitions ──────────────────────────────────────────────────────────
type TTab = 'scanner' | 'bulk' | 'ultimate';

const TABS: { id: TTab; label: string; icon: string; accent: string }[] = [
    { id: 'scanner',  label: 'AI Scanner',      icon: '🔍', accent: '#00b4ff' },
    { id: 'bulk',     label: 'Bulk Trading',     icon: '⚡', accent: '#7f5cff' },
    { id: 'ultimate', label: 'Ultimate Trader',  icon: '🏆', accent: '#f5a623' },
];

// ─── Main Component ───────────────────────────────────────────────────────────
const AIHub = observer(() => {
    const [activeTab, setActiveTab] = useState<TTab>('scanner');

    return (
        <div className='aihub-page'>

            {/* ─── Header ─── */}
            <div className='aihub-header'>
                <div className='aihub-header__text'>
                    <h1>AI Hub</h1>
                    <p>Your intelligent trading command centre — powered by machine learning and real-time market data.</p>
                </div>
                <div className='aihub-header__badge'>Mesoflix Intelligence</div>
            </div>

            {/* ─── Tab Bar ─── */}
            <div className='aihub-tabs'>
                {TABS.map(tab => (
                    <button
                        key={tab.id}
                        className={`aihub-tab ${activeTab === tab.id ? 'aihub-tab--active' : ''}`}
                        style={{ '--tab-accent': tab.accent } as React.CSSProperties}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        <span className='aihub-tab__icon'>{tab.icon}</span>
                        <span className='aihub-tab__label'>{tab.label}</span>
                        {activeTab === tab.id && <span className='aihub-tab__indicator' />}
                    </button>
                ))}
            </div>

            {/* ─── Sub-page content ─── */}
            <div className='aihub-content'>
                {activeTab === 'scanner'  && <AIScannerPage />}
                {activeTab === 'bulk'     && <BulkTradingPageTab />}
                {activeTab === 'ultimate' && <UltimateTraderPage />}
            </div>

        </div>
    );
});

export default AIHub;
