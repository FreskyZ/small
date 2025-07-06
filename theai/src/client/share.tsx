/** @jsxImportSource @emotion/react */
import { useState, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { css } from '@emotion/react';
import * as I from '../shared/api.js';

function CaretRightOutlined() {
    return <svg viewBox="0 0 1024 1024" focusable="false" data-icon="caret-right" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M715.8 493.5L335 165.1c-14.2-12.2-35-1.2-35 18.5v656.8c0 19.7 20.8 30.7 35 18.5l380.8-328.4c10.9-9.4 10.9-27.6 0-37z"></path></svg>;
}

function App() {
    const [infoCollapsed, setInfoCollapsed] = useState(true);
    const styles2 = useMemo(() => createSessionAuxiliaryStyles(true, infoCollapsed), [infoCollapsed]);
    const styles3 = useMemo(() => createConversationStyles(true), []);

    // this session contains all information and messages
    const [session, setSession] = useState<I.Session>(null);
    const [messagePath, setMessagePath] = useState<number[]>([]);

    useEffect(() => {
        (async () => {
            const shareId = window.location.pathname.substring(7);
            if (shareId) {
                const session = await api.publicGetSession(shareId);
                const messages = session.messages;
                const messagePath: number[] = [messages.find(m => !m.parentId).id];
                while (messages.some(m => m.parentId == messagePath[messagePath.length - 1])) {
                    messagePath.push(messages.find(m => m.parentId == messagePath[messagePath.length - 1]).id);
                }
                setSession(session);
                setMessagePath(messagePath);
            } else {
                const url = new URL(window.location.toString());
                url.pathname = '/share';
                window.history.replaceState(null, '', url.toString());
            }
        })();
    }, []);

    const handleNavigateBranch = (message: I.Message, next: boolean) => {
        const messages = session.messages;
        const siblings = messages.filter(m => m.parentId == message.parentId).map(m => m.id);
        const newMessageId = siblings[siblings.indexOf(message.id) + (next ? 1 : -1)];
        const newMessagePath = messagePath.slice(0, messagePath.indexOf(message.id)).concat(newMessageId);
        while (messages.some(m => m.parentId == newMessagePath[newMessagePath.length - 1])) {
            newMessagePath.push(messages.find(m => m.parentId == newMessagePath[newMessagePath.length - 1]).id);
        }
        setMessagePath(newMessagePath);
    };

    const messages = session ? session.messages : [];
    return <>
        <div css={styles2.sessionContainer}>
            <div css={styles2.sessionNameContainer} onClick={() => session && setInfoCollapsed(!infoCollapsed)}>
                <span css={styles2.sessionName}>{session?.name}</span>
                <button css={styles2.collapseButton} title='Collapse'><CaretRightOutlined /></button>
            </div>
            {!!session && <div css={styles2.sessionInfoContainer}>
                <span css={styles2.label}>Name</span>
                <input value={session.name} readOnly={true} />
                <span css={styles2.label}>Comment</span>
                <textarea value={session.comment} readOnly={true} />
            </div>}
            {!!session && <div css={styles3.sessionContentContainer}>
                {messagePath.map(mid => messages.find(m => m.id == mid)).map((m, i) => <div key={i} css={styles3.messageContainer}>
                    <div css={styles3.messageHeader}>
                        <span css={styles3.role}>{m.role.toUpperCase()}</span>
                        {messages.filter(a => a.parentId == m.parentId).map(a => a.id).length > 1 && <button
                            css={[styles3.headerButton, styles3.prevButton]} title="Prev"
                            disabled={messages.filter(a => a.parentId == m.parentId).map(a => a.id).indexOf(m.id) == 0}
                            onClick={() => handleNavigateBranch(m, false)}><CaretRightOutlined /></button>}
                        {messages.filter(a => a.parentId == m.parentId).map(a => a.id).length > 1 && <span css={styles3.pageDisplay}>
                            {messages.filter(a => a.parentId == m.parentId).map(a => a.id).indexOf(m.id) + 1}/{messages.filter(a => a.parentId == m.parentId).map(a => a.id).length}</span>}
                        {messages.filter(a => a.parentId == m.parentId).map(a => a.id).length > 1 && <button
                            css={styles3.headerButton} title='Next'
                            disabled={messages.filter(a => a.parentId == m.parentId).map(a => a.id).indexOf(m.id) == messages.filter(a => a.parentId == m.parentId).map(a => a.id).length - 1}
                            onClick={() => handleNavigateBranch(m, true)}><CaretRightOutlined /></button>}
                    </div>
                    <textarea css={styles3.textarea} value={m.content} readOnly={true} />
                </div>)}
            </div>}
        </div>
    </>;
}

const createSessionAuxiliaryStyles = (listCollapsed: boolean, collapsed: boolean) => ({
     sessionContainer: css({
        width: listCollapsed ? 'calc(100vw - 20px)' : 'calc(100vw - 300px)',
        marginTop: '-50px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
    }),
    sessionNameContainer: css({
        marginTop: '4px',
        borderRadius: '4px',
        cursor: 'pointer',
        height: '24px',
        display: 'flex',
        padding: '2px 2px 2px 8px',
        '&:hover': {
            background: '#ccc',
        },
    }),
    sessionName: css({
        fontWeight: 'bold',
        lineHeight: '24px',
        marginRight: '4px',
        userSelect: 'none',
        maxWidth: '200px',
        display: 'inline-block',
        textOverflow: 'ellipsis',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
    }),
    collapseButton: css({
        background: 'transparent',
        border: 'none',
        outline: 'none',
        fontSize: '14px',
        cursor: 'pointer',
        rotate: collapsed ? '90deg' : '-90deg',
        // transformOrigin: '13px 9px',
    }),
    sessionInfoContainer: css({
        background: '#eee',
        borderRadius: '8px',
        boxShadow: '0 4px 4px rgba(40, 46, 56, 0.15)',
        padding: collapsed ? 0 : '8px',
        height: collapsed ? 0 : undefined,
        overflow: 'hidden',
        marginTop: '12px',
        width: '100%',
        maxWidth: '400px',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        'textarea': {
            resize: 'vertical',
        },
    }),
    label: css({
        fontSize: '12px',
        color: '#333',
    }),
});
const createConversationStyles = (listCollapsed: boolean) => ({
    sessionContentContainer: css({
        overflowX: 'hidden',
        overflowY: 'auto',
        width: listCollapsed ? 'calc(100vw - 20px)' : 'calc(100vw - 300px)',
        maxWidth: '800px',
        maxHeight: 'calc(100vh - 60px)',
    }),
    messageContainer: css({
    }),
    messageHeader: css({
        display: 'flex',
        gap: '4px',
        padding: '4px 4px 0 4px',
        height: '32px',
        boxSizing: 'border-box',
    }),
    role: css({
        lineHeight: '28px',
        cursor: 'default',
        marginRight: '4px',
    }),
    pageDisplay: css({
        fontSize: '12px',
        lineHeight: '28px',
        cursor: 'default',
    }),
    headerButton: css({
        background: 'transparent',
        border: 'none',
        outline: 'none',
        padding: '6px',
        fontSize: '12px',
        cursor: 'pointer',
        '&:hover': {
            background: '#eee',
        },
        'svg': {
            marginRight: '2px',
        }
    }),
    prevButton: css({
        rotate: '180deg',
    }),
    textarea: css({
        resize: 'vertical',
        width: 'calc(100% - 16px)',
    }),
});

createRoot(document.querySelector('main')).render(<App />);

// this is the remove access token version of sendRequest
async function sendAnonymousRequest(method: string, path: string, parameters?: any, data?: any): Promise<any> {
    const url = new URL(`https://api.example.com/chat${path}`);
    Object.entries(parameters || {}).forEach(p => url.searchParams.append(p[0], p[1].toString()));
    const response = await fetch(url.toString(), data ? {
        method,
        body: JSON.stringify(data),
        headers: { 'content-type': 'application/json' },
    } : { method });

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
    publicGetSession: (shareId: string): Promise<I.Session> => sendAnonymousRequest('GET', '/public/v1/session', { shareId }),
};
