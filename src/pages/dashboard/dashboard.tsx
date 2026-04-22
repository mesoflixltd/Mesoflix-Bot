import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import OnboardTourHandler from '../tutorials/dbot-tours/onboarding-tour';
import {
    LabelPairedTiktokCaptionIcon,
    LabelPairedTelegramCaptionIcon,
    LabelPairedWhatsappCaptionIcon,
    LabelPairedYoutubeCaptionIcon,
} from '@deriv/quill-icons/LabelPaired';
import Announcements from './announcements';
import Cards from './cards';
import InfoPanel from './info-panel';

type TMobileIconGuide = {
    handleTabChange: (active_number: number) => void;
};

const DashboardComponent = observer(({ handleTabChange }: TMobileIconGuide) => {
    const { load_modal, dashboard, client } = useStore();
    const { dashboard_strategies } = load_modal;
    const { active_tab, active_tour } = dashboard;
    const has_dashboard_strategies = !!dashboard_strategies?.length;
    const { isDesktop, isTablet } = useDevice();

    return (
        <React.Fragment>
            <div
                className={classNames('tab__dashboard', {
                    'tab__dashboard--tour-active': active_tour,
                })}
            >
                <div className='tab__dashboard__content'>
                    {client.is_logged_in && (
                        <Announcements is_mobile={!isDesktop} is_tablet={isTablet} handleTabChange={handleTabChange} />
                    )}
                    <div className='quick-panel'>
                        <div
                            className={classNames('tab__dashboard__header', {
                                'tab__dashboard__header--listed': isDesktop && has_dashboard_strategies,
                            })}
                        >
                            <div className='dashboard__social-links'>
                                <a href='https://wa.me/254725666447' target='_blank' rel='noopener noreferrer' className='social-link social-link--whatsapp' title='WhatsApp'>
                                    <div className='icon-wrapper'>
                                        <LabelPairedWhatsappCaptionIcon width='24px' height='24px' fill='#25D366' />
                                    </div>
                                </a>
                                <a href='https://t.me/mesoflix' target='_blank' rel='noopener noreferrer' className='social-link social-link--telegram' title='Telegram'>
                                    <div className='icon-wrapper'>
                                        <LabelPairedTelegramCaptionIcon width='24px' height='24px' fill='#0088cc' />
                                    </div>
                                </a>
                                <a href='https://youtube.com' target='_blank' rel='noopener noreferrer' className='social-link social-link--youtube' title='YouTube'>
                                    <div className='icon-wrapper'>
                                        <LabelPairedYoutubeCaptionIcon width='24px' height='24px' fill='#FF0000' />
                                    </div>
                                </a>
                                <a href='https://tiktok.com' target='_blank' rel='noopener noreferrer' className='social-link social-link--tiktok' title='TikTok'>
                                    <div className='icon-wrapper'>
                                        <LabelPairedTiktokCaptionIcon width='24px' height='24px' fill='#00F2EA' />
                                    </div>
                                </a>
                            </div>
                            {!has_dashboard_strategies && (
                                <Text
                                    className='title'
                                    as='h2'
                                    color='prominent'
                                    size={isDesktop ? 'sm' : 's'}
                                    lineHeight='xxl'
                                    weight='bold'
                                >
                                    {localize('Load or build your bot')}
                                </Text>
                            )}
                            <Text
                                as='p'
                                color='prominent'
                                lineHeight='s'
                                size={isDesktop ? 's' : 'xxs'}
                                className={classNames('subtitle', { 'subtitle__has-list': has_dashboard_strategies })}
                            >
                                {localize(
                                    'Import a bot from your computer or Google Drive, build it from scratch, or start with a quick strategy.'
                                )}
                            </Text>
                        </div>
                        <Cards has_dashboard_strategies={has_dashboard_strategies} is_mobile={!isDesktop} />
                    </div>
                </div>
            </div>
            <InfoPanel />
            {active_tab === 0 && <OnboardTourHandler is_mobile={!isDesktop} />}
        </React.Fragment>
    );
});

export default DashboardComponent;
