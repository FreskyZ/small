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

let accessToken: string;
function getAuthorizationHeader() {
    return { 'authorization': 'Bearer ' + accessToken };
}

// interface TreeItem {
//     level: number,
//     kind: 'directory' | 'session',
//     id: number,
//     name: string,
//     tooltip: string,
// }

function App() {
    const styles = pageStyles;

    // ATTENTION for now flat display and use the items, implement later
    // const [_rootDirectory, setRootDirectory] = useState<I.SessionDirectory>({ id: 0, name: '', directories: [], sessions: [] });
    const [lookupSessions, setLookupSessions] = useState<I.LookupSession[]>([]);
    // const [sessionId, setSessionId] = useState(0); // 0 for new session
    const [currentSession, setCurrentSession] = useState<I.Session>(null);
    const [versionNumber, setVersionNumber] = useState(1);

    useEffect(() => {
        (async () => {
            const response = await fetch(`https://api.example.com/chat/v1/sessions`, { headers: getAuthorizationHeader() });
            const root: I.SessionDirectory = await response.json();
            const flatSessions: I.LookupSession[] = [];
            function collectFlatSessions(directory: I.SessionDirectory) {
                for (const subdirectory of directory.directories) {
                    collectFlatSessions(subdirectory);
                }
                flatSessions.push(...directory.sessions);
            }
            collectFlatSessions(root);
            setLookupSessions(flatSessions);
        })();
    }, []);

    const handleCreateSession = async () => {
        const response = await fetch(`https://api.example.com/chat/v1/create-session`, { method: 'POST', headers: getAuthorizationHeader() });
        const result: I.Session = await response.json();
        console.log(result);
    };
    const handleOpenSession = async (sessionId: number) => {
        const response = await fetch(`https://api.example.com/chat/v1/session/${sessionId}`, { headers: getAuthorizationHeader() });
        const result: I.Session = await response.json();
        setCurrentSession(result);
    };
    const handleShareVersion = async () => {
        const response = await fetch(`https://api.example.com/chat/v1/share-version/${currentSession.id}/${versionNumber}`, { method: 'POST', headers: getAuthorizationHeader() });
        const result: I.ShareResult = await response.json();
        notification(`https://chat.example.com/share/${result.id}`);
    };

    const handleSaveMessages = async () => {
        const messages = currentSession ? currentSession.versions.find(v => v.version == versionNumber).messages : [];
        if (!messages || !messages.length) { return; }
        await fetch(`https://api.example.com/chat/v1/update-messages/${currentSession.id}/${versionNumber}`, {
            method: 'POST',
            headers: { ...getAuthorizationHeader(), 'Content-Type': 'application/json' },
            body: JSON.stringify(messages),
        });
    };
    const handleDuplicateVersion = async () => {
        const response = await fetch(`https://api.example.com/chat/v1/duplicate-version/${currentSession.id}/${versionNumber}`, {
            method: 'POST',
            headers: getAuthorizationHeader(),
        });
        const newVersion: I.SessionVersion = await response.json();
        currentSession.versions.push(newVersion);
        setVersionNumber(newVersion.version);
    };
    const handleCompleteMessage = async () => {
        try {
            const response = await fetch(`https://api.example.com/chat/v1/completions/${currentSession.id}/${versionNumber}`, {
                method: 'POST',
                headers: getAuthorizationHeader(),
            });
            const newVersion: I.SessionVersion = await response.json();
            const newVersions = currentSession.versions.map(v => v.version == versionNumber ? newVersion : v);
            setCurrentSession({ ...currentSession, versions: newVersions });
        } catch (error) {
            notification('failed to comlete: ' + error.message);
        }
    };

    const handleEditMessage = (index: number, newContent: string) => {
        const newMessages = messages.map((m, i) => i == index ? { ...m, content: newContent } : m);
        const newVersions = currentSession.versions.map(v => v.version == versionNumber ? { ...v, messages: newMessages } : v);
        setCurrentSession({ ...currentSession, versions: newVersions });
    };
    const handleDeleteMessage = (index: number) => {
        const newMessages = messages.slice(0, index);
        const newVersions = currentSession.versions.map(v => v.version == versionNumber ? { ...v, messages: newMessages } : v);
        setCurrentSession({ ...currentSession, versions: newVersions });
    };
    const handleAddMessage = () => {
        const messages = currentSession.versions.find(v => v.version == versionNumber).messages;
        const lastMessage = messages[messages.length - 1];
        const newMessage: I.Message = { role: lastMessage.role == 'user' ? 'assistant' : 'user', content: '' };
        const newMessages = [...messages, newMessage];
        const newVersions = currentSession.versions.map(v => v.version == versionNumber ? { ...v, messages: newMessages } : v);
        setCurrentSession({ ...currentSession, versions: newVersions });
    };

    const messages = currentSession ? currentSession.versions.find(v => v.version == versionNumber).messages : [];
    return <div css={css({ width: '100vw' })}>
        <div css={styles.tree}>
            <button onClick={handleCreateSession}>New Session</button>
            {lookupSessions.map(s => <div key={s.id} onClick={() => handleOpenSession(s.id)}>{s.name}</div>)}
        </div>
        <div css={styles.sessionContainer}>
            <div css={styles.sessionContainerHeader}>
                {currentSession && <select value={versionNumber} onChange={e => setVersionNumber(Number(e.target.value))}>
                    {currentSession.versions.map(v => <option key={v.version} value={v.version}>V{v.version}</option>)}
                </select>}
                <button onClick={handleSaveMessages}>SAVE</button>
                <button onClick={handleDuplicateVersion}>FORK</button>
                <button onClick={handleShareVersion}>SHARE</button>
            </div>
            {messages.map((m, i) => <div key={i} css={styles.messageContainer}>
                <button title="delete this and following messages" onClick={() => handleDeleteMessage(i)}>DELETE</button>
                <span>{m.role}</span>
                <textarea value={m.content} onChange={e => handleEditMessage(i, e.target.value)} />
            </div>)}
            <div css={styles.messageContainer}>
                <button onClick={handleAddMessage}>ADD</button>
                <button onClick={handleCompleteMessage}>COMPLETE!</button>
            </div>
        </div>
    </div>;
}
const pageStyles = {
    tree: css({
        label: 'tree',
        float: 'left',
        height: 'calc(100vh - 50px)',
        width: '220px',
        // TODO
        '@media (max-width: 600px)': {

        },
    }),
    sessionContainer: css({
        label: 'session-container',
        float: 'left',
        height: 'calc(100vh - 50px)',
    }),
    sessionContainerHeader: css({

    }),
    messageContainer: css({
    }),
};

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
