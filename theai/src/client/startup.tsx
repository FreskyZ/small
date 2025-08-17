/** @jsxImportSource @emotion/react */
import { ReactNode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { css } from '@emotion/react';
import { notification } from './notification.js';

// placeholder when some other people find the page and open without access token
// should be more interesting than always invoke id.example.com and display an login form
function PlaceholderPage({ content, handleContinue }: {
    content: string,
    handleContinue: () => void,
}) {
    const styles = {
        app: css({ maxWidth: '360px', margin: '32vh auto' }),
        fakeText: css({ fontSize: '14px' }),
        mainText: css({ fontSize: '10px', color: '#666', marginTop: '8px' }),
        button: css({ border: 'none', outline: 'none', background: 'transparent', cursor: 'pointer', fontSize: '14px', borderRadius: '4px', '&:hover': { background: '#ccc' } }),
    };
    return <div css={styles.app}>
        <div css={styles.fakeText}>{content}</div>
        <div css={styles.mainText}>
            I mean, access token not found, if you are me, click <button css={styles.button} onClick={
                handleContinue
            }>CONTINUE</button>, or else you seems to be here by accident or curious, you may leave here because there is no content for you, or you may continue your curiosity by finding my contact information.
        </div>
    </div>;
}

function WaitAuthenticationModal({ setSetOpen, handleComplete }: {
    setSetOpen: (setOpen: (open: boolean) => void) => void,
    // return newaccesstoken = null for cancel
    handleComplete: (newAccessToken: string) => void,
}) {
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    setSetOpen(setOpen);

    const styles = useMemo(() => ({
        mask: css({ position: 'fixed', inset: 0, backgroundColor: '#7777', display: open ? 'block' : 'none' }),
        container: css({ zIndex: 100, position: 'relative', margin: '60px auto', padding: '12px',
            borderRadius: '8px', backgroundColor: 'white', maxWidth: '320px', boxShadow: '3px 3px 10px 4px rgba(0,0,0,0.15)', display: open ? 'block' : 'none' }),
        title: css({ fontWeight: 'bold', marginBottom: '8px' }),
        buttonContainer: css({ display: 'flex', flexFlow: 'row-reverse', gap: '12px', marginTop: '12px' }),
        button: css({ fontSize: '14px', border: 'none', outline: 'none', cursor: 'pointer', background: 'transparent' }),
    }), [open]);

    const handleRetry = async () => {
        setLoading(true);
        const localStorageAccessToken = localStorage['access-token'];
        const response = await fetch('https://api.example.com/user-credential', { headers: { authorization: 'Bearer ' + localStorageAccessToken } });
        if (response.ok) {
            setOpen(false);
            setLoading(false);
            handleComplete(localStorageAccessToken);
            notification('Successfully authenticated, try your previous operation again');
        } else {
            setLoading(false);
            notification('still not ok? try again?');
        }
    };
    return <>
        <div css={styles.mask}></div>
        <div css={styles.container}>
            <div css={styles.title}>CONFIRM</div>
            <div>Authentication failed, click OPEN to duplicate a page to authenticate, click RETRY to check authenticate result, click CANCEL to try again later.</div>
            <div css={styles.buttonContainer}>
                <button css={styles.button} disabled={loading} onClick={() => window.open(window.location.href, '_blank')}>OPEN</button>
                <button css={styles.button} disabled={loading} onClick={handleRetry}>RETRY</button>
                <button css={styles.button} disabled={loading} onClick={() => setOpen(false)}>CANCEL</button>
            </div>
        </div>
    </>;
}

let accessToken: string;
// mock access token expiration
(window as any)['setaccesstoken'] = (v: string) => accessToken = v;

// // this function is really long, complex and unexpected
export async function startup<T>(
    mainRootElement: HTMLElement,
    modalRootElement: HTMLElement,
    placeholderText: string,
    mainElement: () => ReactNode,
    appname: string,
    makeapi: (sendRequest: (method: string, path: string, parameters?: any, data?: any) => Promise<any>) => T,
): Promise<T> {
    const mainRoot = createRoot(mainRootElement);
    const modalRoot = createRoot(modalRootElement);
    let setWaitAuthenticationModalOpen: (open: boolean) => void;
    let handleWaitAuthenticationModalComplete: (newAccessToken: string) => void;
    modalRoot.render(<WaitAuthenticationModal
        setSetOpen={setOpen => setWaitAuthenticationModalOpen = setOpen}
        handleComplete={v => handleWaitAuthenticationModalComplete?.(v)} />);

    const localStorageAccessToken = localStorage['access-token'];
    const authorizationCode = new URLSearchParams(window.location.search).get('code');

    if (localStorageAccessToken) {
        const response = await fetch('https://api.example.com/user-credential', { headers: { authorization: 'Bearer ' + localStorageAccessToken } });
        if (response.ok) {
            accessToken = localStorageAccessToken;
            mainRoot.render(mainElement());
        }
    } else if (!authorizationCode && window.location.pathname.length == 1 && !window.location.search) {
        // only display placeholder when no access token, no authorization code and no path, else directly goto signin
        await new Promise<void>(resolve => mainRoot.render(<PlaceholderPage content={placeholderText} handleContinue={resolve} />));
    }
    if (!accessToken) {
        if (!authorizationCode) {
            if (window.location.pathname.length > 1) {
                localStorage['return-pathname'] = window.location.pathname;
            }
            if (window.location.search) {
                localStorage['return-searchparams'] = window.location.search;
            }
            window.location.assign(`https://id.example.com?return=https://${window.location.host}`);
        } else {
            const url = new URL(window.location.toString());
            url.searchParams.delete('code');
            if (localStorage['return-pathname']) {
                url.pathname = localStorage['return-pathname'];
                localStorage.removeItem('return-pathname');
            }
            if (localStorage['return-searchparams']) {
                url.search = localStorage['return-searchparams'];
                localStorage.removeItem('return-searchparams');
            }
            window.history.replaceState(null, '', url.toString());
            const response = await fetch('https://api.example.com/signin', { method: 'POST', headers: { authorization: 'Bearer ' + authorizationCode } });
            if (response.status != 200) {
                notification('Failed to sign in, how does that happen?');
            } else {
                accessToken = localStorage['access-token'] = (await response.json()).accessToken;
                mainRoot.render(mainElement());
            }
        }
    }

    return makeapi(async (method: string, path: string, parameters?: any, data?: any) => {
        const url = new URL(`https://api.example.com/${appname}${path}`);
        Object.entries(parameters || {}).forEach(p => url.searchParams.append(p[0], p[1].toString()));

        const response = await fetch(url.toString(), data ? {
            method,
            body: JSON.stringify(data),
            headers: { 'authorization': 'Bearer ' + accessToken, 'content-type': 'application/json' },
        } : { method, headers: { 'authorization': 'Bearer ' + accessToken } });

        if (response.status == 401) {
            setWaitAuthenticationModalOpen(true);
            const newAccessToken = await new Promise<string>(resolve => handleWaitAuthenticationModalComplete = resolve);
            if (!newAccessToken) {
                return Promise.reject('Authentication failed.');
            } else {
                accessToken = newAccessToken;
                return; // ATTENTION this return undefined need to be handled in api invocations
            }
        }
        // normal/error both return json body, but void do not
        const hasJsonBody = response.headers.has('content-Type') && response.headers.get('content-Type').includes('application/json');
        const responseData = hasJsonBody ? await response.json() : {};
        return response.ok ? Promise.resolve(responseData)
            : response.status >= 400 && response.status < 500 ? Promise.reject(responseData)
            : response.status >= 500 ? Promise.reject({ message: 'internal error' })
            : Promise.reject({ message: 'unknown error' });
    });
}
