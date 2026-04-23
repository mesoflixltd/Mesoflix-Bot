import { useEffect, useState, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { load, save_types } from '@/external/bot-skeleton';
import { DBOT_TABS } from '@/constants/bot-contents';
import { Localize } from '@deriv-com/translations';
import { 
    LabelPairedPuzzlePieceTwoCaptionBoldIcon, 
    LabelPairedPlusLgFillIcon,
    LabelPairedChartMixedCaptionBoldIcon,
    LabelPairedPlayCaptionBoldIcon,
    LabelPairedSearchCaptionBoldIcon,
    LabelPairedCircleInfoCaptionBoldIcon
} from '@deriv/quill-icons/LabelPaired';
import { Text } from '@deriv-com/ui';
import './freebots.scss';

interface BotManifestItem {
    id: string;
    name: string;
    description: string;
    category: string;
    icon: string;
    status?: string;
    accuracy: number;
    isPremium: boolean;
}

const FreeBots = observer(() => {
    const { dashboard } = useStore();
    const [bots, setBots] = useState<BotManifestItem[]>([]);
    const [loadingBotId, setLoadingBotId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        const fetchManifest = async () => {
            try {
                const response = await fetch('/bots/manifest.json');
                const data = await response.json();
                setBots(data);
            } catch (error) {
                console.error('Failed to load bots manifest:', error);
            }
        };

        fetchManifest();
    }, []);

    const filteredBots = useMemo(() => {
        return bots.filter(bot => 
            bot.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            bot.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
            bot.category.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [bots, searchTerm]);

    const handleLoadBot = async (bot: BotManifestItem) => {
        setLoadingBotId(bot.id);
        try {
            const response = await fetch(`/bots/${bot.name}`);
            const xml_string = await response.text();
            
            const clean_name = bot.name.replace(/\.[^/.]+$/, "");

            await load({
                block_string: xml_string,
                file_name: clean_name,
                workspace: window.Blockly.derivWorkspace,
                from: save_types.LOCAL,
                strategy_id: bot.id,
                showIncompatibleStrategyDialog: false,
                drop_event: {},
                show_snackbar: true
            } as any);

            dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
            
        } catch (error) {
            console.error('Error loading bot:', error);
        } finally {
            setLoadingBotId(null);
        }
    };

    const getIcon = (iconName: string) => {
        const props = { width: '24px', height: '24px', fill: 'currentColor' };
        switch (iconName) {
            case 'ai': return <LabelPairedPlusLgFillIcon {...props} />;
            case 'chart': return <LabelPairedChartMixedCaptionBoldIcon {...props} />;
            default: return <LabelPairedPuzzlePieceTwoCaptionBoldIcon {...props} />;
        }
    };

    return (
        <div className='freebots-page'>
            <div className='freebots-page__header'>
                <div className='freebots-page__header-content'>
                    <div className='freebots-page__header-text'>
                        <Text as='h1' weight='bold'><Localize i18n_default_text='Elite Bot Repository 2026' /></Text>
                        <Text color='less-prominent'>
                            <Localize i18n_default_text='Market-ready automated protocols for institutional-grade execution.' />
                        </Text>
                    </div>
                    <div className='freebots-page__search-wrapper'>
                        <LabelPairedSearchCaptionBoldIcon className='freebots-page__search-icon' />
                        <input 
                            type='text' 
                            placeholder='Search strategies...' 
                            className='freebots-page__search-input'
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            <div className='freebots-page__scroll-container'>
                <div className='freebots-page__grid'>
                    {filteredBots.map((bot) => (
                        <div key={bot.id} className='bot-card'>
                            {bot.isPremium && <div className='bot-card__premium-ribbon'>PREMIUM</div>}
                            
                            <div className='bot-card__top'>
                                <div className='bot-card__icon-wrapper'>
                                    {getIcon(bot.icon)}
                                </div>
                                {bot.status && (
                                    <div className={`bot-card__status bot-card__status--${bot.status.toLowerCase()}`}>
                                        {bot.status}
                                    </div>
                                )}
                            </div>

                            <div className='bot-card__info'>
                                <Text as='h3' weight='bold' className='bot-card__title'>
                                    {bot.name.replace(/\.[^/.]+$/, "").replace(/_/g, ' ')}
                                </Text>
                                <Text color='less-prominent' className='bot-card__description'>
                                    {bot.description}
                                </Text>
                            </div>

                            <div className='bot-card__stats'>
                                <div className='bot-card__stat-header'>
                                    <Text size='xs' weight='bold' color='prominent'>Accuracy Rate</Text>
                                    <Text size='xs' weight='bold' className='bot-card__accuracy-value'>{bot.accuracy}%</Text>
                                </div>
                                <div className='bot-card__progress-bg'>
                                    <div 
                                        className='bot-card__progress-fill' 
                                        style={{ width: `${bot.accuracy}%` }}
                                    />
                                </div>
                            </div>

                            <div className='bot-card__footer'>
                                <div className='bot-card__category-pill'>
                                    <LabelPairedCircleInfoCaptionBoldIcon width='12px' height='12px' />
                                    <span>{bot.category}</span>
                                </div>
                                <button 
                                    className={`bot-card__load-btn ${loadingBotId === bot.id ? 'bot-card__load-btn--loading' : ''}`}
                                    onClick={() => handleLoadBot(bot)}
                                    disabled={loadingBotId !== null}
                                >
                                    {loadingBotId === bot.id ? (
                                        <div className='bot-card__loader' />
                                    ) : (
                                        <>
                                            <LabelPairedPlayCaptionBoldIcon width='16px' height='16px' fill='white' />
                                            <span>Load Bot</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
});

export default FreeBots;
