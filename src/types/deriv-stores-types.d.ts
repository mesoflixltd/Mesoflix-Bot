declare module '@deriv/stores/types' {
    export type TAccount = {
        loginid: string;
        currency?: string;
        is_virtual?: number;
        balance?: number | string;
        [key: string]: unknown;
    };

    export type TStores = {
        client?: {
            loginid?: string;
            currency?: string;
            is_virtual?: boolean;
            account_list?: TAccount[];
            [key: string]: unknown;
        };
        ui?: {
            [key: string]: unknown;
        };
        [key: string]: unknown;
    };

    export type TPortfolioPosition = {
        buy_price?: number;
        payout?: number;
        profit?: number;
        contract_id?: number;
        status?: string;
        transaction_id?: string | number;
        transaction_ids?: {
            buy?: string | number;
            sell?: string | number;
        };
        [key: string]: unknown;
    };

    export type TNotificationMessage = {
        className?: string;
        message?: string;
        [key: string]: unknown;
    };
}
