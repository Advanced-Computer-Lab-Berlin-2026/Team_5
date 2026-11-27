
export class CheckoutError extends Error {
    constructor(statusCode, code, message) {
        super(message);

        this.name = 'CheckoutError';
        this.statusCode = statusCode;
        this.code = code;
    }
}
