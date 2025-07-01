
export interface RequestState {
    public: boolean,
    user: { id: number, name: string },
}

export interface DispatchContext {
    method: string,
    // GET api.domain.com/app1/v1/something
    //           this part:   ^^^^^^^^^^^^^
    path: string,
    body: any,
    state: RequestState,
}
export interface DispatchResult {
    body?: any,
    status?: number,
    error?: Error,
}

export interface ActionContext {
    userId: number,
    userName: string,
}

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
