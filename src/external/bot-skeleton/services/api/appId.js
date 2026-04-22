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
 * Clears the singleton instance (useful for logout or forced reconnection)
 */
export const clearDerivApiInstance = () => {
    if (derivApiInstance?.connection) {
        try {
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
 * Prevents multiple WebSocket connections by reusing existing instance
 * Now supports async WebSocket URL fetching with authenticated flow
 * @param {boolean} forceNew - Force creation of new instance (default: false)
 * @returns Promise with DerivAPIBasic instance
 */
export const generateDerivApiInstance = async (forceNew = false) => {
    // If forcing new instance, clear existing one
    if (forceNew) {
        console.log('[DerivAPI] Forcing new instance creation');
        clearDerivApiInstance();
    }

    // If there's already an instance, check its state
    if (derivApiInstance) {
        const readyState = derivApiInstance.connection?.readyState;
        
        // If OPEN, return immediately
        if (readyState === WebSocket.OPEN) {
            console.log('[DerivAPI] Reusing existing instance (state: OPEN)');
            return derivApiInstance;
        }
        
        // If CONNECTING, wait for the existing creation promise or the 'open' event
        if (readyState === WebSocket.CONNECTING) {
            console.log('[DerivAPI] Instance is connecting, waiting for ready state...');
            if (derivApiPromise) return derivApiPromise;
            
            // Fallback: wait for the open event on the existing connection
            return new Promise((resolve, reject) => {
                const conn = derivApiInstance.connection;
                const onOpen = () => {
                    cleanup();
                    resolve(derivApiInstance);
                };
                const onError = (err) => {
                    cleanup();
                    reject(err);
                };
                const cleanup = () => {
                    conn.removeEventListener('open', onOpen);
                    conn.removeEventListener('error', onError);
                };
                conn.addEventListener('open', onOpen);
                conn.addEventListener('error', onError);
                
                // Safety timeout
                setTimeout(() => {
                    cleanup();
                    reject(new Error('WebSocket connection timeout during reuse'));
                }, 10000);
            });
        }
        
        // Connection is closed or closing, clear it
        console.log('[DerivAPI] Existing instance not usable (state:', readyState, '), creating new');
        clearDerivApiInstance();
    }

    // If there's already a creation in progress, return that promise
    if (derivApiPromise) {
        console.log('[DerivAPI] Reusing existing creation promise');
        return derivApiPromise;
    }

    // Create new instance if none exists or previous attempt failed
    derivApiPromise = (async () => {
        try {
            // Await the async getSocketURL() function
            const wsURL = await getSocketURL();

            // Check if URL changed (account switch scenario)
            if (currentWebSocketURL && currentWebSocketURL !== wsURL) {
                console.log('[DerivAPI] WebSocket URL changed, clearing old instance');
                clearDerivApiInstance();
            }

            currentWebSocketURL = wsURL;

            console.log('[DerivAPI] Creating new WebSocket connection to:', wsURL);
            const deriv_socket = new WebSocket(wsURL);
            const deriv_api = new DerivAPIBasic({
                connection: deriv_socket,
                middleware: new APIMiddleware({}),
            });

            // Store the instance immediately
            derivApiInstance = deriv_api;

            // Return a promise that resolves when the connection is OPEN
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    cleanup();
                    reject(new Error('WebSocket connection timeout'));
                }, 15000);

                const onOpen = () => {
                    cleanup();
                    console.log('[DerivAPI] WebSocket connection established');
                    resolve(deriv_api);
                };

                const onError = error => {
                    cleanup();
                    console.error('[DerivAPI] WebSocket connection error:', error);
                    reject(error);
                };

                const onClose = () => {
                    console.log('[DerivAPI] WebSocket connection closed');
                    if (derivApiInstance === deriv_api) {
                        derivApiInstance = null;
                        derivApiPromise = null; // Clear promise on close to allow re-init
                        currentWebSocketURL = null;
                    }
                    cleanup();
                };

                const cleanup = () => {
                    clearTimeout(timeout);
                    deriv_socket.removeEventListener('open', onOpen);
                    deriv_socket.removeEventListener('error', onError);
                    deriv_socket.removeEventListener('close', onClose);
                };

                deriv_socket.addEventListener('open', onOpen);
                deriv_socket.addEventListener('error', onError);
                deriv_socket.addEventListener('close', onClose);
            });
        } catch (error) {
            console.error('[DerivAPI] Error creating instance:', error);
            derivApiPromise = null;
            derivApiInstance = null;
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
