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
                    <rect x="4" y="10" width="40" height="26" rx="3" fill="var(--general-section-1)" stroke="#ff444f" strokeWidth="2.5"/>
                    <path d="M12 36L10 42H38L36 36H12Z" fill="#ff444f"/>
                    <rect x="10" y="16" width="28" height="14" rx="1" fill="#1e1e1e"/>
                    <path d="M14 22H24M14 26H30M14 19H34" stroke="#ff444f" strokeWidth="2" strokeLinecap="round"/>
                    <circle cx="34" cy="23" r="4" fill="#ff444f" fillOpacity="0.3"/>
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
                    <rect x="2" y="2" width="44" height="44" rx="8" stroke="white" strokeWidth="0.5" strokeOpacity="0.1"/>
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
                    <rect x="8" y="8" width="32" height="32" rx="4" stroke="#377cfc" strokeWidth="3" strokeDasharray="3 3"/>
                    <path d="M14 24H20M28 24H34M24 14V20M24 28V34" stroke="#377cfc" strokeWidth="2.5" strokeLinecap="round"/>
                    <rect x="21" y="21" width="6" height="6" rx="1" fill="#377cfc">
                        <animate attributeName="opacity" values="0.5;1;0.5" dur="2s" repeatCount="indefinite" />
                    </rect>
                    <path d="M12 12L16 16M32 32L36 36M36 12L32 16M16 32L12 36" stroke="#377cfc" strokeWidth="2" strokeLinecap="round"/>
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
                    <circle cx="24" cy="24" r="18" stroke="#ff444f" strokeWidth="2.5" strokeOpacity="0.2"/>
                    <path d="M24 6V10M42 24H38M24 42V38M6 24H10" stroke="#ff444f" strokeWidth="3" strokeLinecap="round"/>
                    <path d="M36.7 11.3L33.9 14.1M36.7 36.7L33.9 33.9M11.3 36.7L14.1 33.9M11.3 11.3L14.1 14.1" stroke="#ff444f" strokeWidth="2" strokeOpacity="0.5"/>
                    <path d="M24 24L34 14" stroke="#ff444f" strokeWidth="4" strokeLinecap="round"/>
                    <circle cx="24" cy="24" r="5" fill="#ff444f"/>
                    <path d="M7 24C7 14.6112 14.6112 7 24 7" stroke="#ff444f" strokeWidth="3" strokeLinecap="round">
                        <animate attributeName="stroke-dasharray" from="0 60" to="60 60" dur="1.5s" repeatCount="indefinite" />
                    </path>
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
