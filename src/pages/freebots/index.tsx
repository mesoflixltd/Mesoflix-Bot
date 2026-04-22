import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { load, save_types } from '@/external/bot-skeleton';
import { DBOT_TABS } from '@/constants/bot-contents';
import { Localize } from '@deriv-com/translations';
import { 
    LabelPairedPuzzlePieceTwoCaptionBoldIcon, 
    LabelPairedPlusLgFillIcon,
    LabelPairedChartMixedCaptionBoldIcon,
    LabelPairedPlayCaptionBoldIcon
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
}

const FreeBots = observer(() => {
    const { dashboard } = useStore();
    const [bots, setBots] = useState<BotManifestItem[]>([]);
    const [loadingBotId, setLoadingBotId] = useState<string | null>(null);

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

    const handleLoadBot = async (bot: BotManifestItem) => {
        setLoadingBotId(bot.id);
        try {
            const response = await fetch(`/bots/${bot.name}`);
            const xml_string = await response.text();
            
            // Clean name for display (remove .xml)
            const clean_name = bot.name.replace(/\.[^/.]+$/, "");

            await load({
                block_string: xml_string,
                file_name: clean_name,
                workspace: window.Blockly.derivWorkspace,
                from: save_types.LOCAL,
                strategy_id: bot.id,
                showIncompatibleStrategyDialog: false,
                drop_event: {}, // Required property
                show_snackbar: true
            } as any);

            // Redirect to Bot Builder
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
                <Text as='h1'><Localize i18n_default_text='FreeBots Marketplace' /></Text>
                <Text color='less-prominent'>
                    <Localize i18n_default_text='Explore and load high-performance automated strategies curated for the 2026 market.' />
                </Text>
            </div>

            <div className='freebots-page__scroll-container'>
                <div className='freebots-page__grid'>
                    {bots.map((bot) => (
                        <div key={bot.id} className='bot-card'>
                            {bot.status && (
                                <div className={`bot-card__badge bot-card__badge--${bot.status.toLowerCase()}`}>
                                    {bot.status}
                                </div>
                            )}
                            <div className='bot-card__icon'>
                                {getIcon(bot.icon)}
                            </div>
                            <div className='bot-card__info'>
                                <Text as='h3'>{bot.name.replace(/\.[^/.]+$/, "")}</Text>
                                <Text color='less-prominent'>{bot.description}</Text>
                            </div>
                            <div className='bot-card__footer'>
                                <div className='bot-card__category'>{bot.category}</div>
                                <button 
                                    className={`bot-card__load-btn ${loadingBotId === bot.id ? 'bot-card__load-btn--loading' : ''}`}
                                    onClick={() => handleLoadBot(bot)}
                                    disabled={loadingBotId !== null}
                                >
                                    {loadingBotId === bot.id ? (
                                        <Localize i18n_default_text='Loading...' />
                                    ) : (
                                        <>
                                            <LabelPairedPlayCaptionBoldIcon width='14px' height='14px' fill='white' />
                                            <span><Localize i18n_default_text='Load Bot' /></span>
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
