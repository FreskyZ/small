/** @jsxImportSource @emotion/react */
import { useState, useEffect } from 'react';
// import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { css } from '@emotion/react';
import * as I from '../shared/api.js';

const notificationElement = document.querySelector<HTMLSpanElement>('span#notification');
// const modalMaskElement = document.querySelector<HTMLDivElement>('div#modal-mask');
// const modalContainerElement = document.querySelector<HTMLDivElement>('div#modal-container');

let notificationTimer: any;
function notification(message: string) {
    if (notificationTimer) {
        clearTimeout(notificationTimer);
    }
    notificationElement.style.display = 'inline';
    notificationElement.innerText = message;
    notificationTimer = setTimeout(() => {
        notificationElement.style.display = 'none';
    }, 5000);
}

function DeleteOutlined() {
    return <svg viewBox="64 64 896 896" focusable="false" data-icon="delete" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M360 184h-8c4.4 0 8-3.6 8-8v8h304v-8c0 4.4 3.6 8 8 8h-8v72h72v-80c0-35.3-28.7-64-64-64H352c-35.3 0-64 28.7-64 64v80h72v-72zm504 72H160c-17.7 0-32 14.3-32 32v32c0 4.4 3.6 8 8 8h60.4l24.7 523c1.6 34.1 29.8 61 63.9 61h454c34.2 0 62.3-26.8 63.9-61l24.7-523H888c4.4 0 8-3.6 8-8v-32c0-17.7-14.3-32-32-32zM731.3 840H292.7l-24.2-512h487l-24.2 512z"></path></svg>;
}
function MenuFoldOutlined() {
    return <svg viewBox="64 64 896 896" focusable="false" data-icon="menu-fold" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M408 442h480c4.4 0 8-3.6 8-8v-56c0-4.4-3.6-8-8-8H408c-4.4 0-8 3.6-8 8v56c0 4.4 3.6 8 8 8zm-8 204c0 4.4 3.6 8 8 8h480c4.4 0 8-3.6 8-8v-56c0-4.4-3.6-8-8-8H408c-4.4 0-8 3.6-8 8v56zm504-486H120c-4.4 0-8 3.6-8 8v56c0 4.4 3.6 8 8 8h784c4.4 0 8-3.6 8-8v-56c0-4.4-3.6-8-8-8zm0 632H120c-4.4 0-8 3.6-8 8v56c0 4.4 3.6 8 8 8h784c4.4 0 8-3.6 8-8v-56c0-4.4-3.6-8-8-8zM115.4 518.9L271.7 642c5.8 4.6 14.4.5 14.4-6.9V388.9c0-7.4-8.5-11.5-14.4-6.9L115.4 505.1a8.74 8.74 0 000 13.8z"></path></svg>;
}
function ShareOutlined() {
    return <svg viewBox="64 64 896 896" focusable="false" data-icon="share-alt" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M752 664c-28.5 0-54.8 10-75.4 26.7L469.4 540.8a160.68 160.68 0 000-57.6l207.2-149.9C697.2 350 723.5 360 752 360c66.2 0 120-53.8 120-120s-53.8-120-120-120-120 53.8-120 120c0 11.6 1.6 22.7 4.7 33.3L439.9 415.8C410.7 377.1 364.3 352 312 352c-88.4 0-160 71.6-160 160s71.6 160 160 160c52.3 0 98.7-25.1 127.9-63.8l196.8 142.5c-3.1 10.6-4.7 21.8-4.7 33.3 0 66.2 53.8 120 120 120s120-53.8 120-120-53.8-120-120-120zm0-476c28.7 0 52 23.3 52 52s-23.3 52-52 52-52-23.3-52-52 23.3-52 52-52zM312 600c-48.5 0-88-39.5-88-88s39.5-88 88-88 88 39.5 88 88-39.5 88-88 88zm440 236c-28.7 0-52-23.3-52-52s23.3-52 52-52 52 23.3 52 52-23.3 52-52 52z"></path></svg>;
}
// function EditOutlined() {
//     return <svg viewBox="64 64 896 896" focusable="false" data-icon="edit" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M257.7 752c2 0 4-.2 6-.5L431.9 722c2-.4 3.9-1.3 5.3-2.8l423.9-423.9a9.96 9.96 0 000-14.1L694.9 114.9c-1.9-1.9-4.4-2.9-7.1-2.9s-5.2 1-7.1 2.9L256.8 538.8c-1.5 1.5-2.4 3.3-2.8 5.3l-29.5 168.2a33.5 33.5 0 009.4 29.8c6.6 6.4 14.9 9.9 23.8 9.9zm67.4-174.4L687.8 215l73.3 73.3-362.7 362.6-88.9 15.7 15.6-89zM880 836H144c-17.7 0-32 14.3-32 32v36c0 4.4 3.6 8 8 8h784c4.4 0 8-3.6 8-8v-36c0-17.7-14.3-32-32-32z"></path></svg>;
// }

function App() {
    const styles = pageStyles;

    // this list does not include messages
    const [sessions, setSessions] = useState<I.Session[]>([]);
    // null for not selected, 0 for new?
    const [sessionId, setSessionId] = useState(null);
    // current selected session's all messages
    const [messages, setMessages] = useState<I.Message[]>([]);
    // current displaying message id path, may contain 0 for the final adding message
    const [messagePath, setMessagePath] = useState<number[]>([]);

    const [menuCollapsed, setMenuCollapsed] = useState(false);

    useEffect(() => {
        (async () => { setSessions(await api.getSessions()); })();
    }, []);

    const handleAddSession = async () => {
        const result = await api.addSession({} as I.Session);
        setSessions(sessions.concat(result));
        setSessionId(result.id);
        setMessages(result.messages);
        setMessagePath([result.messages[0].id]);
    };
    const handleSelectSession = async (sessionId: number) => {
        const messages = await api.getSessionMessages(sessionId);
        // session's message list cannot be empty, so this find must have result
        const messagePath: number[] = [messages.find(m => !m.parentId).id];
        while (messages.some(m => m.parentId == messagePath[messagePath.length - 1])) {
            messagePath.push(messages.find(m => m.parentId == messagePath[messagePath.length - 1]).id);
        }
        setSessionId(sessionId);
        setMessages(messages);
        setMessagePath(messagePath);
    };
    const handleUpdateSession = async (sessionId: number) => {
        await api.updateSession(sessions.find(s => s.id == sessionId));
        notification(`update complete`);
    };
    const handleDeleteSession = async (sessionId: number) => {
        if (confirm('delete session?')) {
            await api.removeSession(sessionId);
        }
    };

    const handleShareClick = async () => {
        if (session.shareId) {
            await api.unshareSession(sessionId);
            session.shareId = null;
            setSessions([...sessions]);
            notification('Unshared!');
        } else {
            const result = await api.shareSession(sessionId);
            session.shareId = result.id;
            setSessions([...sessions]);
            notification('Shared!');
        }
    };
    const handleCopyShareLink = () => {
        if (session.shareId) {
            navigator.clipboard.writeText(`https://chat.example.com/share/${session.shareId}`);
            notification('Copied to clipboard!');
        }
    };

    const handleNavigateToSibling = (message: I.Message, next: boolean) => {
        const siblings = messages.filter(m => m.parentId == message.parentId).map(m => m.id);
        const newMessageId = siblings[siblings.indexOf(message.id) + (next ? 1 : -1)];
        setMessagePath(messagePath.slice(0, messagePath.indexOf(message.id)).concat(newMessageId));
    };
    const handleAddMessage = () => {
        const lastRole = messages.find(m => m.id == messagePath[messagePath.length - 1]).role;
        setMessages(messages.concat({ id: 0, parentId: messagePath[messagePath.length - 1], role: lastRole == 'system' || lastRole == 'assistant' ? 'user' : 'assistant', content: '' }));
        setMessagePath(messagePath.concat(0));
    };

    const handleUpdateMessage = async (message: I.Message) => {
        await api.updateMessage(sessionId, message);
    };
    const handleBranchMessage = async (message: I.Message) => {
        const result = await api.addMessage(sessionId, message);
        if (message.id == 0) {
            setMessagePath(messagePath.slice(0, messagePath.length - 1).concat(result.id));
        } else {
            const branchIndex = messagePath.findIndex(id => message.id == id);
            setMessagePath(messagePath.slice(0, branchIndex).concat(result.id));
        }
    };
    const handleDeleteMessage = async (messageId: number) => {
        if (messageId == 0) {
            setMessages(messages.filter(m => m.id != 0));
            setMessagePath(messagePath.slice(0, messagePath.length - 1));
        } else {
            if (confirm('delete this and following message?')) {
                await api.removeMessageTree(sessionId, messageId);
            }
            await handleSelectSession(sessionId);
        }
    };
    const handleCompleteMessage = async () => {
        const result = await api.completeMessage(sessionId, messagePath[messagePath.length - 1]);
        setMessages(messages.concat(result));
        setMessagePath(messagePath.concat(result.id));
    };

    const session = sessions.find(s => s.id == sessionId);
    return <>
        <div css={[styles.list, menuCollapsed && css({ width: '38px' })]}>
            <div css={styles.listHeader}>
                {!menuCollapsed && <button css={styles.newButton} onClick={() => handleAddSession()}>New Chat</button>}
                <button css={[styles.collapseButton, menuCollapsed && css({ marginLeft: 0 })]}
                    title='Collapse' onClick={() => setMenuCollapsed(!menuCollapsed)}><MenuFoldOutlined /></button>
            </div>
            {!menuCollapsed &&  sessions.map(s => <div key={s.id} css={styles.listItem}>
                <span title={`${s.comment ?? ''}${s.tags.length > 0
                    ? '\n' : ''}${s.tags.join(',')}\n${s.createTime}`}
                    onClick={() => handleSelectSession(s.id)}>{s.name}</span>
                <button onClick={() => handleDeleteSession(s.id)} title="Delete"><DeleteOutlined /></button>
            </div>)}
        </div>
        <div css={[styles.sessionContainer, css({ width: menuCollapsed ? 'calc(100vw - 120px)' : 'calc(100vw - 360px)' })]}>
            {session ? <>
                <div css={styles.sessionContainerHeader}>
                    <label>Name</label>
                    <input value={session.name} onChange={e => { session.name = e.target.value; setSessions([...sessions]); }} />
                    <button onClick={() => handleUpdateSession(sessionId)}>SAVE</button>
                    <label>Comment</label>
                    <textarea value={session.comment} onChange={e => { session.comment = e.target.value; setSessions([...sessions]); }} />
                    <button onClick={() => handleUpdateSession(sessionId)}>SAVE</button>
                    <button title={session.shareId ? 'Unshare' : 'Share'} onClick={handleShareClick}><ShareOutlined /></button>
                    <input value={session.shareId ? `https://chat.example.com/share/${session.shareId}` : ''} readOnly={true} />
                    <button onClick={() => handleCopyShareLink()}>COPY</button>
                </div>
                <div css={css({  })}>
                    <button onClick={handleAddMessage}>ADD</button>
                    <button css={styles.completeButton} onClick={handleCompleteMessage}>COMPLETE!</button>
                </div>
                {messagePath.map(mid => messages.find(m => m.id == mid)).map((m, i) => <div key={i} css={styles.messageContainer}>
                    <span>{m.role}</span>
                    {/* TODO https://marked.js.org/#usage */}
                    <textarea value={m.content} cols={100} rows={4}
                        onChange={e => { m.content = e.target.value; setMessages([...messages]) }} />
                    <button onClick={() => handleNavigateToSibling(m, false)}>PREV</button>
                    <button onClick={() => handleNavigateToSibling(m, true)}>NEXT</button>
                    <button onClick={() => handleUpdateMessage(m)}>SAVE AS UPDATE</button>
                    <button onClick={() => handleBranchMessage(m)}>SAVE AS BRANCH</button>
                    <button title="delete this and following messages" onClick={() => handleDeleteMessage(m.id)}>DELETE</button>
                </div>)}
            </> : <div>TODO start new session</div>}
        </div>
    </>;
}
const pageStyles = {
    list: css({
        float: 'left',
        height: 'calc(100vh - 88px)',
        width: '280px',
        background: '#e7e7e7',
        borderRadius: '10px',
        padding: '12px',
        transition: 'width 0.2s',
        // TODO
        '@media (max-width: 600px)': {
        },
    }),
    listHeader: css({
        display: 'flex',
    }),
    newButton: css({
        padding: '8px 16px',
        fontSize: '16px',
        fontWeight: 'bold',
        color: '#333',
        backgroundColor: '#ccc',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(40, 46, 56, 0.15)',
        transition: 'background 0.2s, box-shadow 0.2s, opacity 0.2s',
        '&:hover': {
            boxShadow: '0 3px 12px rgba(68, 74, 87, 0.25)',
        },
    }),
    collapseButton: css({
        marginLeft: '136px',
        border: 'none',
        background: 'none',
        padding: '10px 11px 5px 11px',
        borderRadius: '6px',
        cursor: 'pointer',
        fontSize: '16px',
        color: '#333',
        '&:hover': {
            background: '#ccc',
        }
    }),
    listItem: css({
        width: '276px',
        borderRadius: '6px',
        padding: '0 0 0 8px',
        height: '36px',
        cursor: 'pointer',
        marginLeft: '-2px',
        display: 'flex',
        transition: 'opacity 0.2s',
        '&:nth-child(2)': {
            marginTop: '8px',
        },
        'span': {
            lineHeight: '36px',
            width: '240px',
            display: 'inline-block',
        },
        'button': {
            display: 'none',
            border: 'none',
            background: 'none',
            padding: '10px 11px 5px 11px',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '16px',
            '&:hover': {
                background: '#aaa',
            }
        },
        '&:hover': {
            background: '#ccc',
            'button': {
                display: 'inline',
            }
        }
    }),
    sessionContainer: css({
        float: 'left',
        marginLeft: '12px',
        height: 'calc(100vh - 50px)',
    }),
    sessionContainerHeader: css({
        display: 'grid',
        gap: '4px',
        gridTemplateRows: '24px 24px 24px',
        gridTemplateColumns: '36px 160px 60px',
    }),
    completeButton: css({
        // TODO this is major button
    }),
    messageContainer: css({
    }),
};

let accessToken: string;
async function startup() {
    const authorizationCode = new URLSearchParams(window.location.search).get('code');
    if (!authorizationCode) {
        window.location.assign(`https://id.example.com?return=https://chat.example.com`);
    } else {
        const url = new URL(window.location.toString());
        url.searchParams.delete('code');
        window.history.replaceState(null, '', url.toString());
        const response = await fetch(`https://api.example.com/signin`, { method: 'POST', headers: { authorization: 'Bearer ' + authorizationCode } });
        if (response.status != 200) {
            notification('Something went wrong. (1)');
        } else {
            accessToken = (await response.json()).accessToken;
            createRoot(document.querySelector('main')).render(<App />);
        }
    }
}
await startup();

// AUTOGEN
// --------------------------------------
// ------ ATTENTION AUTO GENERATED ------
// --------------------------------------

async function sendRequest(method: string, path: string, parameters?: any, data?: any): Promise<any> {
    const url = new URL(`https://api.example.com/chat${path}`);
    Object.entries(parameters || {}).forEach(p => url.searchParams.append(p[0], p[1].toString()));
    const response = await fetch(url.toString(), data ? {
        method,
        body: JSON.stringify(data),
        headers: { 'authorization': 'Bearer ' + accessToken, 'content-type': 'application/json' },
    } : { method, headers: { 'authorization': 'Bearer ' + accessToken } });

    // normal/error both return json body, but void do not
    const hasResponseBody = response.headers.has('content-Type')
        && response.headers.get('content-Type').includes('application/json');
    const responseData = hasResponseBody ? await response.json() : {};
    return response.ok ? Promise.resolve(responseData)
        : response.status >= 400 && response.status < 500 ? Promise.reject(responseData)
        : response.status >= 500 ? Promise.reject({ message: 'internal error' })
        : Promise.reject({ message: 'unknown error' });
}
const api = {
    getSessions: (): Promise<I.Session[]> => sendRequest('GET', '/v1/sessions'),
    getSessionMessages: (sessionId: number): Promise<I.Message[]> => sendRequest('GET', '/v1/session-messages', { sessionId }),
    publicGetSession: (shareId: string): Promise<I.Session> => sendRequest('GET', '/public/v1/session', { shareId }),
    addSession: (data: I.Session): Promise<I.Session> => sendRequest('PUT', '/v1/add-session', {}, data),
    updateSession: (data: I.Session): Promise<I.Session> => sendRequest('POST', '/v1/update-session', {}, data),
    removeSession: (sessionId: number): Promise<void> => sendRequest('DELETE', '/v1/remove-session', { sessionId }),
    addMessage: (sessionId: number, data: I.Message): Promise<I.Message> => sendRequest('PUT', '/v1/add-message', { sessionId }, data),
    updateMessage: (sessionId: number, data: I.Message): Promise<I.Message> => sendRequest('POST', '/v1/update-message', { sessionId }, data),
    removeMessageTree: (sessionId: number, messageId: number): Promise<void> => sendRequest('DELETE', '/v1/remove-message-tree', { sessionId, messageId }),
    completeMessage: (sessionId: number, messageId: number): Promise<I.Message> => sendRequest('POST', '/v1/complete-message', { sessionId, messageId }),
    shareSession: (sessionId: number): Promise<I.SharedSession> => sendRequest('POST', '/v1/share-session', { sessionId }),
    unshareSession: (sessionId: number): Promise<void> => sendRequest('POST', '/v1/unshare-session', { sessionId }),
    getAccountBalance: (): Promise<I.AccountBalance> => sendRequest('GET', '/v1/account-balance'),
};
