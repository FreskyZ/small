/** @jsxImportSource @emotion/react */
import { useState, useEffect } from 'react';
// import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { css } from '@emotion/react';
import * as I from './shared.js';

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

function App() {
    const styles = pageStyles;

    const [_rootDirectory, setRootDirectory] = useState<I.SessionDirectory>({ id: 0, name: '', directories: [], sessions: [] });
    const [lookupSessions, setLookupSessions] = useState<I.LookupSession[]>([]);
    // const [sessionId, setSessionId] = useState(0); // 0 for new session
    const [currentSession, setCurrentSession] = useState<I.Session>(null);
    const [versionNumber, _setVersionNumber] = useState(1);

    useEffect(() => {
        (async () => {
            const response = await fetch(`https://api.example.com/chat/v1/sessions`, { headers: getAuthorizationHeader() });
            const result: I.SessionDirectory = await response.json();
            setRootDirectory(result);
            const flatSessions: I.LookupSession[] = [];
            function collectFlatSessions(directory: I.SessionDirectory) {
                for (const subdirectory of directory.directories) {
                    collectFlatSessions(subdirectory);
                }
                flatSessions.push(...directory.sessions);
            }
            collectFlatSessions(result);
            setLookupSessions(flatSessions);
        })();
    }, []);

    const handleOpenSession = async (sessionId: number) => {
        const response = await fetch(`https://api.example.com/chat/v1/session/${sessionId}`, { headers: getAuthorizationHeader() });
        const result: I.Session = await response.json();
        setCurrentSession(result);
    }

    const handleCreateSession = async () => {
        const response = await fetch(`https://api.example.com/chat/v1/create-session`, { method: 'POST', headers: getAuthorizationHeader() });
        const result: I.Session = await response.json();
        console.log(result);
    };

    const messages = currentSession ? currentSession.versions.find(v => v.version == versionNumber).messages : [];
    return <div css={css({ width: '100vw' })}>
        <button onClick={handleCreateSession}>New Session</button>
        <div css={styles.tree}>{lookupSessions.map(s => 
            <div key={s.id} onClick={() => handleOpenSession(s.id)}>{s.name}</div>
        )}</div>
        <div css={styles.sessionContainer}>{messages.map((m, i) => <div key={i}>{m.role}: {m.content}</div>)}</div>
    </div>;
}
const pageStyles = {
    tree: css({

    }),
    sessionContainer: css({

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
