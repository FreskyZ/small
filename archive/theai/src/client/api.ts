// --------------------------------------
// ------ ATTENTION AUTO GENERATED ------
// --------------------------------------

import type { startup } from './startup.js';
import type * as I from '../shared/api-types.js';

export const makeapi = (sendRequest: Parameters<Parameters<typeof startup>[5]>[0]) => ({
    getSessions: (): Promise<I.Session[]> => sendRequest('GET', '/v1/sessions'),
    getSession: (sessionId: number): Promise<I.Session> => sendRequest('GET', '/v1/session', { sessionId }),
    addSession: (data: I.Session): Promise<I.Session> => sendRequest('PUT', '/v1/add-session', {}, data),
    updateSession: (data: I.Session): Promise<I.Session> => sendRequest('POST', '/v1/update-session', {}, data),
    removeSession: (sessionId: number): Promise<void> => sendRequest('DELETE', '/v1/remove-session', { sessionId }),
    addMessage: (sessionId: number, data: I.Message): Promise<I.Message> => sendRequest('PUT', '/v1/add-message', { sessionId }, data),
    updateMessage: (sessionId: number, data: I.Message): Promise<I.Message> => sendRequest('POST', '/v1/update-message', { sessionId }, data),
    removeMessageTree: (sessionId: number, messageId: number): Promise<void> => sendRequest('DELETE', '/v1/remove-message-tree', { sessionId, messageId }),
    completeMessage: (sessionId: number, messageId: number): Promise<I.Message> => sendRequest('POST', '/v1/complete-message', { sessionId, messageId }),
    shareSession: (sessionId: number): Promise<I.ShareSessionResult> => sendRequest('POST', '/v1/share-session', { sessionId }),
    unshareSession: (sessionId: number): Promise<void> => sendRequest('POST', '/v1/unshare-session', { sessionId }),
    getModels: (): Promise<string[]> => sendRequest('GET', '/v1/models'),
    getAccountBalance: (): Promise<I.AccountBalance> => sendRequest('GET', '/v1/account-balance'),
});
