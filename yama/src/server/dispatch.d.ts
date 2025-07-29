import type { Dayjs } from "dayjs";

export interface RequestState {
    now: Dayjs,
    public: boolean,
    user: { id: number, name: string },
}

export interface DispatchContext {
    method: string,
    // GET api.example.com/app1/v1/something?param1=value1&param2=value2
    //  this part, include query: ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    // GET api.example.com/app1/public/v1/something?param1=value1
    //           not include /public: ^^^^^^^^^^^^^^^^^^^^^^^^^^^
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
    now: Dayjs,
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
