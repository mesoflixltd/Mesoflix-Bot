/* [AI] - Analytics removed - utility functions moved to @/utils/account-helpers */
import { getAccountId, getAccountType, isDemoAccount, removeUrlParameter } from '@/utils/account-helpers';
/* [/AI] */
import CommonStore from '@/stores/common-store';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import { TAuthData } from '@/types/api-types';
import { clearAuthData } from '@/utils/auth-utils';
import { handleBackendError, isBackendError } from '@/utils/error-handler';
import { activeSymbolsProcessorService } from '../../../../services/active-symbols-processor.service';
import { observer as globalObserver } from '../../utils/observer';
import { doUntilDone, socket_state } from '../tradeEngine/utils/helpers';
import {
    CONNECTION_STATUS,
    setAccountList,
    setAuthData,
    setConnectionStatus,
    setIsAuthorized,
    setIsAuthorizing,
} from './observables/connection-status-stream';
import ApiHelpers from './api-helpers';
import { generateDerivApiInstance, getToken, V2GetActiveAccountId } from './appId';
import chart_api from './chart-api';

type CurrentSubscription = {
    id: string;
    unsubscribe: () => void;
};

type SubscriptionPromise = Promise<{
    subscription: CurrentSubscription;
}>;

type TApiBaseApi = {
    connection: {
        readyState: keyof typeof socket_state;
        addEventListener: (event: string, callback: (...args: any[]) => void) => void;
        removeEventListener: (event: string, callback: (...args: any[]) => void) => void;
    };
    send: (data: unknown) => Promise<any>;
    disconnect: () => void;
    authorize: (token: string) => Promise<{ authorize: TAuthData; error: any }>;

    onMessage: () => {
        subscribe: (callback: (message: unknown) => void) => {
            unsubscribe: () => void;
        };
    };
} & ReturnType<typeof generateDerivApiInstance>;

class APIBase {
    api: TApiBaseApi | null = null;
    token: string = '';
    account_id: string = '';
    pip_sizes = {};
    account_info = {};
    is_running = false;
    subscriptions: CurrentSubscription[] = [];
    time_interval: ReturnType<typeof setInterval> | null = null;
    has_active_symbols = false;
    is_stopping = false;
    active_symbols: any[] = [];
    current_auth_subscriptions: SubscriptionPromise[] = [];
    is_authorized = false;
    active_symbols_promise: Promise<any[] | undefined> | null = null;
    common_store: CommonStore | undefined;
    reconnection_attempts: number = 0;
    is_initializing = false;
    private init_promise: Promise<void> | null = null;

    // Constants for timeouts - extracted magic numbers for better maintainability
    private readonly ACTIVE_SYMBOLS_TIMEOUT_MS = 10000;
    private readonly ENRICHMENT_TIMEOUT_MS = 10000;
    private readonly MAX_RECONNECTION_ATTEMPTS = 5;

    // Fixed persistence of bound handlers to ensure removeEventListener works correctly
    private onsocketopenBound: (() => void) | null = null;
    private onsocketcloseBound: (() => void) | null = null;

    constructor() {
        this.onsocketopenBound = this.onsocketopen.bind(this);
        this.onsocketcloseBound = this.onsocketclose.bind(this);
    }

    unsubscribeAllSubscriptions = () => {
        this.current_auth_subscriptions?.forEach(subscription_promise => {
            subscription_promise.then(({ subscription }) => {
                if (subscription?.id) {
                    this.api?.send({
                        forget: subscription.id,
                    });
                }
            });
        });
        this.current_auth_subscriptions = [];
    };

    onsocketopen() {
        console.log('[APIBase] Socket opened');
        setConnectionStatus(CONNECTION_STATUS.OPENED);
        this.reconnection_attempts = 0;

        const currentClientStore = globalObserver.getState('client.store');
        if (currentClientStore) {
            currentClientStore.setIsAccountRegenerating(false);
        }

        this.handleTokenExchangeIfNeeded();
    }

    private async handleTokenExchangeIfNeeded() {
        const urlParams = new URLSearchParams(window.location.search);
        const account_id = urlParams.get('account_id');
        const accountType = urlParams.get('account_type');

        if (account_id) {
            localStorage.setItem('active_loginid', account_id);
            removeUrlParameter('account_id');
        }
        if (accountType) {
            localStorage.setItem('account_type', accountType);
            removeUrlParameter('account_type');
        }

        let activeAccountId: string | null = getAccountId();

        if (!activeAccountId) {
            try {
                const storedAccounts = sessionStorage.getItem('deriv_accounts');
                if (storedAccounts) {
                    const accounts = JSON.parse(storedAccounts);
                    if (accounts && accounts.length > 0 && accounts[0].account_id) {
                        const accountId = accounts[0].account_id as string;
                        activeAccountId = accountId;
                        localStorage.setItem('active_loginid', accountId);
                        const isDemo = accountId.startsWith('VRT') || accountId.startsWith('VRTC');
                        localStorage.setItem('account_type', isDemo ? 'demo' : 'real');
                    }
                }
            } catch (error) {
                console.error('[APIBase] Error reading accounts from sessionStorage:', error);
            }
        }

        if (activeAccountId) {
            await this.authorizeAndSubscribe();
        }
    }

    onsocketclose() {
        console.log('[APIBase] Socket closed, state:', this.api?.connection?.readyState);
        setConnectionStatus(CONNECTION_STATUS.CLOSED);
        
        // Add a slight delay before reconnecting to prevent infinite loops if disconnect triggers close
        setTimeout(() => {
            this.reconnectIfNotConnected();
        }, 100);
    }

    async init(force_create_connection = false) {
        if (this.is_initializing && !force_create_connection) {
            return this.init_promise;
        }

        this.is_initializing = true;
        this.init_promise = (async () => {
            try {
                this.toggleRunButton(true);

                if (this.api) {
                    this.unsubscribeAllSubscriptions();
                }

                if (!force_create_connection) {
                    this.reconnection_attempts = 0;
                }

                const current_ready_state = this.api?.connection?.readyState;
                const is_socket_usable = this.api && current_ready_state === 1;

                if (!is_socket_usable || force_create_connection) {
                    if (this.api?.connection) {
                        try {
                            // Properly remove existing listeners before disconnecting
                            if (this.onsocketopenBound) {
                                this.api.connection.removeEventListener('open', this.onsocketopenBound);
                            }
                            if (this.onsocketcloseBound) {
                                this.api.connection.removeEventListener('close', this.onsocketcloseBound);
                            }
                            
                            ApiHelpers.disposeInstance();
                            setConnectionStatus(CONNECTION_STATUS.CLOSED);
                            this.api.disconnect();
                        } catch (e) {
                            console.warn('[APIBase] Error during cleanup:', e);
                        }
                    }

                    console.log('[APIBase] Requesting new API instance...');
                    this.api = await generateDerivApiInstance(force_create_connection);
                    
                    if (this.api?.connection) {
                        if (this.onsocketopenBound) {
                            this.api.connection.addEventListener('open', this.onsocketopenBound);
                        }
                        if (this.onsocketcloseBound) {
                            this.api.connection.addEventListener('close', this.onsocketcloseBound);
                        }

                        // If already open, trigger manual setup
                        if (this.api.connection.readyState === 1) {
                            console.log('[APIBase] Socket already open, triggering setup');
                            this.onsocketopen();
                        }
                    }
                }

                const hasAccountID = V2GetActiveAccountId();

                if (!this.has_active_symbols && !hasAccountID) {
                    this.active_symbols_promise = this.getActiveSymbols().then(() => undefined);
                }

                this.initEventListeners();

                if (this.time_interval) clearInterval(this.time_interval);
                this.time_interval = null;

                chart_api.init(force_create_connection);
            } catch (error) {
                console.error('[APIBase] Initialization failed:', error);
                throw error;
            } finally {
                this.is_initializing = false;
            }
        })();

        return this.init_promise;
    }

    getConnectionStatus() {
        if (this.api?.connection) {
            const ready_state = this.api.connection.readyState;
            return socket_state[ready_state as keyof typeof socket_state] || 'Unknown';
        }
        return 'Socket not initialized';
    }

    terminate() {
        if (this.api) {
            if (this.onsocketcloseBound) {
                this.api.connection?.removeEventListener('close', this.onsocketcloseBound);
            }
            this.api.disconnect();
        }
    }

    initEventListeners() {
        if (window) {
            window.addEventListener('online', this.reconnectIfNotConnected);
            window.addEventListener('focus', this.reconnectIfNotConnected);
        }
    }

    async createNewInstance(account_id: string) {
        if (this.account_id !== account_id) {
            await this.init();
        }
    }

    reconnectIfNotConnected = () => {
        if (this.is_initializing) return;

        const readyState = this.api?.connection?.readyState;
        if (readyState === undefined || readyState > 1) { // 2: CLOSING, 3: CLOSED, or non-existent
            this.reconnection_attempts += 1;

            if (this.reconnection_attempts >= this.MAX_RECONNECTION_ATTEMPTS) {
                this.reconnection_attempts = 0;
                setIsAuthorized(false);
                setAccountList([]);
                setAuthData(null);
                localStorage.removeItem('active_loginid');
                localStorage.removeItem('account_type');
                localStorage.removeItem('accountsList');
                localStorage.removeItem('clientAccounts');
                return;
            }

            console.log('[APIBase] Reconnecting (attempt:', this.reconnection_attempts, ')');
            this.init(true);
        }
    };

    async authorizeAndSubscribe() {
        if (!this.api || this.is_authorized && this.token === getAccountId()) return;

        const { token, account_id } = getToken();
        if (!token) {
            setIsAuthorizing(false);
            return;
        }

        this.account_id = account_id || '';
        setIsAuthorizing(true);

        try {
            console.log('[APIBase] Authorizing...');
            const authResponse = await this.api.authorize(token);
            
            if (authResponse.error) {
                throw authResponse.error;
            }

            const { balance, error } = await this.api.send({ balance: 1 });

            if (error) {
                const errorMessage = isBackendError(error) ? handleBackendError(error) : error.message || 'Authorization failed';
                console.error('Authorization error:', errorMessage);
                setIsAuthorizing(false);
                return { ...error, localizedMessage: errorMessage };
            }

            this.account_info = {
                balance: balance?.balance,
                currency: balance?.currency,
                loginid: balance?.loginid,
            };
            this.token = balance?.loginid;

            const account_type = getAccountType(balance?.loginid);
            const currentAccount = balance?.loginid
                ? {
                      balance: balance.balance,
                      currency: balance.currency || 'USD',
                      is_virtual: account_type === 'real' ? 0 : 1,
                      loginid: balance.loginid,
                  }
                : null;

            const storedAccounts = DerivWSAccountsService.getStoredAccounts();
            const accountList =
                storedAccounts && storedAccounts.length > 0
                    ? storedAccounts
                          .filter(a => !a.status || a.status === 'active')
                          .map(a => ({
                                balance: parseFloat(a.balance) || 0,
                                currency: a.currency || 'USD',
                                is_virtual: a.account_type === 'demo' ? 1 : 0,
                                loginid: a.account_id,
                          }))
                    : currentAccount
                      ? [currentAccount]
                      : [];

            setAccountList(accountList);
            setAuthData({
                balance: balance?.balance,
                currency: balance?.currency,
                loginid: balance?.loginid,
                is_virtual: account_type === 'real' ? 0 : 1,
                account_list: accountList,
            });

            const loginid = balance?.loginid || '';
            const isDemo = isDemoAccount(loginid);
            localStorage.setItem('account_type', isDemo ? 'demo' : 'real');

            globalObserver.emit('api.authorize', {
                account_list: accountList,
                current_account: {
                    loginid: balance?.loginid,
                    currency: balance?.currency || 'USD',
                    is_virtual: account_type === 'real' ? 0 : 1,
                    balance: typeof balance?.balance === 'number' ? balance.balance : undefined,
                },
            });

            const currentClientStore = globalObserver.getState('client.store');
            if (currentClientStore && balance?.loginid) {
                currentClientStore.setWebSocketLoginId(balance.loginid);
            }

            setIsAuthorized(true);
            this.is_authorized = true;
            localStorage.setItem('client_account_details', JSON.stringify(accountList));
            localStorage.setItem('client.country', balance?.country);

            if (balance?.loginid) {
                localStorage.setItem('active_loginid', balance.loginid);
            }

            if (this.has_active_symbols) {
                this.toggleRunButton(false);
            } else {
                this.active_symbols_promise = this.getActiveSymbols();
            }
            this.subscribe();
        } catch (e) {
            console.error('[APIBase] Authorization flow failed:', e);
            this.is_authorized = false;
            clearAuthData();
            setIsAuthorized(false);
            globalObserver.emit('Error', e);
        } finally {
            setIsAuthorizing(false);
        }
    }

    async subscribe() {
        const subscribeToStream = async (streamName: string) => {
            try {
                await doUntilDone(
                    () => {
                        const subscription = this.api?.send({
                            [streamName]: 1,
                            subscribe: 1,
                        });

                        if (subscription) {
                            this.current_auth_subscriptions.push(subscription);
                        }
                        return subscription;
                    },
                    [],
                    this
                );
            } catch (err) {
                console.error(`[APIBase] Failed to subscribe to ${streamName}:`, err);
            }
        };

        const streamsToSubscribe = ['balance', 'transaction', 'proposal_open_contract'];
        await Promise.allSettled(streamsToSubscribe.map(subscribeToStream));
    }

    getActiveSymbols = async () => {
        if (!this.api) {
            throw new Error('API connection not available');
        }

        try {
            const timeout = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Active symbols fetch timeout')), this.ACTIVE_SYMBOLS_TIMEOUT_MS)
            );

            const activeSymbolsPromise = doUntilDone(() => this.api?.send({ active_symbols: 'brief' }), [], this);
            const apiResult = await Promise.race([activeSymbolsPromise, timeout]);
            const { active_symbols = [], error = {} } = apiResult as any;

            if (error && Object.keys(error).length > 0) {
                throw new Error(`Active symbols API error: ${error.message || 'Unknown error'}`);
            }

            this.has_active_symbols = true;

            try {
                const enrichmentTimeout = new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('Enrichment timeout')), this.ENRICHMENT_TIMEOUT_MS)
                );

                const enrichmentPromise = activeSymbolsProcessorService.processActiveSymbols(active_symbols);
                const processedResult = await Promise.race([enrichmentPromise, enrichmentTimeout]);

                this.active_symbols = processedResult.enrichedSymbols;
                this.pip_sizes = processedResult.pipSizes;
            } catch (enrichmentError) {
                console.warn('Symbol enrichment failed:', enrichmentError);
                this.active_symbols = active_symbols;
                this.pip_sizes = {};
            }

            this.toggleRunButton(false);
            return this.active_symbols;
        } catch (error) {
            console.error('Failed to fetch and process active symbols:', error);
            throw error;
        }
    };

    toggleRunButton = (toggle: boolean) => {
        const run_button = document.querySelector('#db-animation__run-button');
        if (!run_button) return;
        (run_button as HTMLButtonElement).disabled = toggle;
    };

    setIsRunning(toggle = false) {
        this.is_running = toggle;
    }

    pushSubscription(subscription: CurrentSubscription) {
        this.subscriptions.push(subscription);
    }

    clearSubscriptions() {
        this.subscriptions.forEach(s => s.unsubscribe());
        this.subscriptions = [];
        const global_timeouts = globalObserver.getState('global_timeouts') ?? [];
        global_timeouts.forEach((_: unknown, i: number) => {
            clearTimeout(i);
        });
    }
}

export const api_base = new APIBase();
