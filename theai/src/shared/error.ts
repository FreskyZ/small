
export type MyErrorKind =
    | 'common'
    | 'not-found'
    | 'auth'
    | 'unreachable'
    | 'rate-limit'
    | 'method-not-allowed'
    | 'internal'
    | 'bad-gateway'
    | 'service-not-available'
    | 'gateway-timeout';

// a common error type for all known errors
// - this is currently shared by core module and builtin content servers, and will be shared to app servers in future
// - because core module, content servers and api servers are separate compilation units, so the class definition
//   is not the same constructor object and cannot use instanceof to check, so use .name == 'MyError' to determine known errors
export class MyError extends Error {
    // TODO review use of constructor parameter and distinguish between user message and internal log message
    constructor(
        public readonly kind: MyErrorKind,
        message?: string,
        public readonly additionalInfo?: string,
    ) {
        super(message);
        this.name = 'MyError';
    }
}
