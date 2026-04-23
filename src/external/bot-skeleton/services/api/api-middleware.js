export const REQUESTS = [
    'active_symbols',
    'balance',
    'buy',
    'proposal',
    'proposal_open_contract',
    'transaction',
    'ticks_history',
    'history',
];

class APIMiddleware {
    constructor(config) {
        this.config = config;
        this.debounced_calls = {};
    }

    getRequestType = request => {
        let req_type;
        REQUESTS.forEach(type => {
            if (type in request && !req_type) req_type = type;
        });

        return req_type;
    };

    defineMeasure = res_type => {
        if (res_type) {
            let measure;
            if (res_type === 'history') {
                performance.mark('ticks_history_end');
                measure = performance.measure('ticks_history', 'ticks_history_start', 'ticks_history_end');
            } else {
                performance.mark(`${res_type}_end`);
                measure = performance.measure(`${res_type}`, `${res_type}_start`, `${res_type}_end`);
            }
            return (measure.startTimeDate = new Date(Date.now() - measure.startTime));
        }
        return false;
    };

    sendIsCalled = ({ response_promise, args: [request] }) => {
        const req_type = this.getRequestType(request);
        
        // Log outgoing request (masking sensitive data)
        const log_enabled = window.DERIV_API_LOGGING !== false; // Default to true if not explicitly false
        if (log_enabled) {
            const log_request = { ...request };
            if (log_request.authorize) log_request.authorize = '***';
            console.log('%c[API Request]', 'color: #2196F3; font-weight: bold;', log_request);
        }

        if (req_type) performance.mark(`${req_type}_start`);
        response_promise
            .then(res => {
                // Log incoming response
                if (log_enabled) {
                    console.log('%c[API Response]', 'color: #4CAF50; font-weight: bold;', res);
                }

                const res_type = this.getRequestType(res);
                if (res_type) {
                    this.defineMeasure(res_type);
                }
            })
            .catch(error => {
                if (log_enabled) {
                    console.error('%c[API Error]', 'color: #F44336; font-weight: bold;', error);
                }
            });
        return response_promise;
    };
}

export default APIMiddleware;
