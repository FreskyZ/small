import type { Dayjs } from "dayjs";
import type { UserCredential } from './access-types.js';

export interface RequestState {
    now: Dayjs,
    app: string,
    public: boolean,
    user: UserCredential,
}

export interface ActionServerRequest {
    method: string,
    // GET api.example.com/app1/v1/something?param1=value1&param2=value2
    //  this part, include query: ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    // GET api.example.com/app1/public/v1/something?param1=value1
    //           not include /public: ^^^^^^^^^^^^^^^^^^^^^^^^^^^
    path: string,
    state: RequestState,
    body: any,
}

export interface ActionServerResponse {
    body?: any,
    error?: Error,
}
