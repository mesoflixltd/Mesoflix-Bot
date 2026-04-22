// TODO: Complete MobX integration for popup functionality
// Some code is kept commented out pending popup integration
import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import GoogleDrive from '@/components/load-modal/google-drive';
import Dialog from '@/components/shared_ui/dialog';
import MobileFullPageModal from '@/components/shared_ui/mobile-full-page-modal';
import Text from '@/components/shared_ui/text';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import {
    DerivLightBotBuilderIcon,
    DerivLightGoogleDriveIcon,
    DerivLightLocalDeviceIcon,
    DerivLightMyComputerIcon,
    DerivLightQuickStrategyIcon,
} from '@deriv/quill-icons/Illustration';
import { Localize, localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
/* [AI] - Analytics event tracking removed - see migrate-docs/MONITORING_PACKAGES.md for re-implementation guide */
/* [/AI] */
import DashboardBotList from './bot-list/dashboard-bot-list';

type TCardProps = {
    has_dashboard_strategies: boolean;
    is_mobile: boolean;
};

type TCardArray = {
    id: string;
    icon: React.ReactElement;
    content: React.ReactElement;
    callback: () => void;
};

const Cards = observer(({ is_mobile, has_dashboard_strategies }: TCardProps) => {
    const { dashboard, load_modal, quick_strategy } = useStore();
    const { toggleLoadModal, setActiveTabIndex } = load_modal;
    const { isDesktop } = useDevice();
    const { onCloseDialog, dialog_options, is_dialog_open, setActiveTab, setPreviewOnPopup } = dashboard;
    const { setFormVisibility } = quick_strategy;

    const openFileLoader = () => {
        toggleLoadModal();
        setActiveTabIndex(is_mobile ? 0 : 1);
        setActiveTab(DBOT_TABS.BOT_BUILDER);
    };

    const openGoogleDriveDialog = () => {
        const google_drive_tab_index = isDesktop ? 2 : 1;
        toggleLoadModal();
        setActiveTabIndex(google_drive_tab_index); // Google Drive tab index
        setActiveTab(DBOT_TABS.BOT_BUILDER);
    };

    const actions: TCardArray[] = [
        {
            id: 'my-computer',
            icon: (
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="4" y="8" width="40" height="26" rx="3" fill="var(--general-section-1)" stroke="var(--brand-red-coral)" strokeWidth="2"/>
                    <path d="M12 34L8 40H40L36 34H12Z" fill="var(--brand-red-coral)"/>
                    <rect x="10" y="14" width="28" height="14" rx="1" fill="#151717"/>
                    <path d="M14 20H20M14 24H24M14 16H34" stroke="var(--brand-red-coral)" strokeWidth="1.5" strokeLinecap="round"/>
                    <circle cx="34" cy="24" r="3" fill="var(--brand-red-coral)" fillOpacity="0.3"/>
                </svg>
            ),
            content: is_mobile ? <Localize i18n_default_text='Local' /> : <Localize i18n_default_text='My computer' />,
            callback: () => {
                openFileLoader();
            },
        },
        {
            id: 'google-drive',
            icon: (
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M16.5 8L6 26L11.5 36L22 18L16.5 8Z" fill="#00A65A"/>
                    <path d="M31.5 8L16.5 8L22 18L37 18L31.5 8Z" fill="#4285F4"/>
                    <path d="M11.5 36L32 36L37 26L16.5 26L11.5 36Z" fill="#F4B400"/>
                    <path d="M22 18L16.5 26L31.5 36L37 26L22 18Z" fill="#DB4437" fillOpacity="0.2"/>
                    <path d="M16.5 8L6 26L11.5 36M31.5 8L16.5 8L22 18L37 18L31.5 8ZM11.5 36L32 36L37 26L16.5 26L11.5 36Z" stroke="white" strokeWidth="0.5" strokeOpacity="0.3"/>
                </svg>
            ),
            content: <Localize i18n_default_text='Google Drive' />,
            callback: () => {
                openGoogleDriveDialog();
            },
        },
        {
            id: 'bot-builder',
            icon: (
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="8" y="8" width="32" height="32" rx="4" stroke="var(--brand-blue)" strokeWidth="2" strokeDasharray="4 4"/>
                    <path d="M14 24H18M30 24H34M24 14V18M24 30V34" stroke="var(--brand-blue)" strokeWidth="2" strokeLinecap="round"/>
                    <rect x="20" y="20" width="8" height="8" rx="1" fill="var(--brand-blue)"/>
                    <path d="M14 14L18 18M30 30L34 34M34 14L30 18M18 30L14 34" stroke="var(--brand-blue)" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
            ),
            content: <Localize i18n_default_text='Bot Builder' />,
            callback: () => {
                setActiveTab(DBOT_TABS.BOT_BUILDER);
            },
        },
        {
            id: 'quick-strategy',
            icon: (
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M24 4V10M40 10L35 15M44 24H38M40 38L35 33M24 44V38M8 38L13 33M4 24H10M8 10L13 15" stroke="var(--brand-red-coral)" strokeWidth="2" strokeLinecap="round"/>
                    <path d="M24 24L32 16" stroke="var(--brand-red-coral)" strokeWidth="3" strokeLinecap="round"/>
                    <circle cx="24" cy="24" r="4" fill="var(--brand-red-coral)"/>
                    <path d="M29 32C31.5 29.5 33 26 33 22C33 13.1634 25.8366 6 17 6" stroke="var(--brand-red-coral)" strokeWidth="2" strokeOpacity="0.2"/>
                </svg>
            ),
            content: <Localize i18n_default_text='Quick strategy' />,
            callback: () => {
                setActiveTab(DBOT_TABS.BOT_BUILDER);
                setFormVisibility(true);
            },
        },
    ];

    return React.useMemo(
        () => (
            <div
                className={classNames('tab__dashboard__table', {
                    'tab__dashboard__table--minimized': has_dashboard_strategies && is_mobile,
                })}
            >
                <div
                    className={classNames('tab__dashboard__table__tiles', {
                        'tab__dashboard__table__tiles--minimized': has_dashboard_strategies && is_mobile,
                    })}
                    id='tab__dashboard__table__tiles'
                >
                    {actions.map(icons => {
                        const { icon, content, callback, id } = icons;
                        return (
                            <div
                                key={id}
                                className={classNames('tab__dashboard__table__block', {
                                    'tab__dashboard__table__block--minimized': has_dashboard_strategies && is_mobile,
                                })}
                            >
                                <div
                                    className={classNames('tab__dashboard__table__images', {
                                        'tab__dashboard__table__images--minimized': has_dashboard_strategies,
                                    })}
                                    width='8rem'
                                    height='8rem'
                                    icon={icon}
                                    id={id}
                                    onClick={() => {
                                        callback();
                                    }}
                                >
                                    {icon}
                                </div>
                                <Text color='prominent' size={is_mobile ? 'xxs' : 'xs'}>
                                    {content}
                                </Text>
                            </div>
                        );
                    })}

                    {!isDesktop ? (
                        <Dialog
                            title={dialog_options.title}
                            is_visible={is_dialog_open}
                            onCancel={onCloseDialog}
                            is_mobile_full_width
                            className='dc-dialog__wrapper--google-drive'
                            has_close_icon
                        >
                            <GoogleDrive />
                        </Dialog>
                    ) : (
                        <MobileFullPageModal
                            is_modal_open={is_dialog_open}
                            className='load-strategy__wrapper'
                            header={localize('Load strategy')}
                            onClickClose={() => {
                                setPreviewOnPopup(false);
                                onCloseDialog();
                            }}
                            height_offset='80px'
                        >
                            <div label='Google Drive' className='google-drive-label'>
                                <GoogleDrive />
                            </div>
                        </MobileFullPageModal>
                    )}
                </div>
                <DashboardBotList />
            </div>
        ),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [is_dialog_open, has_dashboard_strategies]
    );
});

export default Cards;
