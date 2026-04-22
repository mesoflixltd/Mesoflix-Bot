import { getSocketURL } from '@/components/shared';
import DerivAPIBasic from '@deriv/deriv-api/dist/DerivAPIBasic';
import APIMiddleware from './api-middleware';

/**
 * Singleton instance management for DerivAPI
 */
let derivApiInstance = null;
let derivApiPromise = null;
let currentWebSocketURL = null;

/**
 * Clears the singleton instance
 */
export const clearDerivApiInstance = () => {
    console.log('[DerivAPI] Clearing singleton instance');
    if (derivApiInstance?.connection) {
        try {
            // Remove listeners if possible or just close
            derivApiInstance.connection.close();
        } catch (error) {
            console.error('[DerivAPI] Error closing WebSocket:', error);
        }
    }
    derivApiInstance = null;
    derivApiPromise = null;
    currentWebSocketURL = null;
};

/**
 * Generates a Deriv API instance with WebSocket connection using singleton pattern
 * @param {boolean} forceNew - Force creation of new instance
 * @returns Promise with DerivAPIBasic instance
 */
export const generateDerivApiInstance = async (forceNew = false) => {
    if (forceNew) {
        clearDerivApiInstance();
    }

    // Check if current instance is still valid
    if (derivApiInstance) {
        const state = derivApiInstance.connection?.readyState;
        if (state === WebSocket.OPEN) {
            return derivApiInstance;
        }
        if (state === WebSocket.CONNECTING) {
            if (derivApiPromise) return derivApiPromise;
        } else {
            // CLOSED or CLOSING
            clearDerivApiInstance();
        }
    }

    if (derivApiPromise) {
        return derivApiPromise;
    }

    derivApiPromise = (async () => {
        try {
            const wsURL = await getSocketURL();
            
            // Handle URL changes (Account switcher)
            if (currentWebSocketURL && currentWebSocketURL !== wsURL) {
                console.log('[DerivAPI] URL changed, resetting connection');
                clearDerivApiInstance();
                // Recurse once to start with new URL
                return generateDerivApiInstance(true);
            }
            currentWebSocketURL = wsURL;

            console.log('[DerivAPI] Establishing connection to:', wsURL);
            const socket = new WebSocket(wsURL);
            const api = new DerivAPIBasic({
                connection: socket,
                middleware: new APIMiddleware({}),
            });

            derivApiInstance = api;

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    cleanup();
                    reject(new Error('Connection timeout'));
                }, 15000);

                const onOpen = () => {
                    cleanup();
                    console.log('[DerivAPI] Connection established');
                    resolve(api);
                };

                const onError = (err) => {
                    cleanup();
                    console.error('[DerivAPI] Connection error');
                    clearDerivApiInstance(); // Ensure we don't reuse failed instances
                    reject(err);
                };

                const cleanup = () => {
                    clearTimeout(timeout);
                    socket.removeEventListener('open', onOpen);
                    socket.removeEventListener('error', onError);
                };

                socket.addEventListener('open', onOpen);
                socket.addEventListener('error', onError);
            });
        } catch (error) {
            derivApiPromise = null;
            throw error;
        }
    })();

    return derivApiPromise;
};

export const getLoginId = () => {
    const login_id = localStorage.getItem('active_loginid');
    if (login_id && login_id !== 'null') return login_id;
    return null;
};

export const V2GetActiveAccountId = () => {
    const account_id = localStorage.getItem('active_loginid');
    if (account_id && account_id !== 'null') return account_id;
    return null;
};

export const getToken = () => {
    const active_loginid = getLoginId();
    const client_accounts = JSON.parse(localStorage.getItem('accountsList')) ?? undefined;
    const active_account = (client_accounts && client_accounts[active_loginid]) || {};
    return {
        token: active_account ?? undefined,
        account_id: active_loginid ?? undefined,
    };
};
