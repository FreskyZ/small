
function EmptyPage({ handleContinue }: {
    handleContinue: () => void,
}) {
    const styles = {
        app: css({ maxWidth: '360px', margin: '32vh auto' }),
        fakeText: css({ fontSize: '14px' }),
        mainText: css({ fontSize: '10px', color: '#666', marginTop: '8px' }),
        button: css({ border: 'none', outline: 'none', background: 'transparent', cursor: 'pointer', fontSize: '14px', borderRadius: '4px', '&:hover': { background: '#ccc' } }),
    };
    return <div css={styles.app}>
        <div css={styles.fakeText}>{emptytext}</div>
        <div css={styles.mainText}>
            I mean, access token not found, if you are me, click <button css={styles.button} onClick={handleContinue}>CONTINUE</button>, or else you seems to be here by accident or curious, you may leave here because there is no content for you, or you may continue your curiosity by finding my contact information.
        </div>
    </div>;
}

let accessToken: string;
(window as any)['setaccesstoken'] = (v: string) => accessToken = v; // test access token expiration

function gotoIdentityProvider() {
    if (window.location.pathname.length > 1) {
        localStorage['return-pathname'] = window.location.pathname;
        localStorage['return-searchparams'] = window.location.search;
    }
    window.location.assign(`https://id.example.com?return=https://${window.location.host}`);
}

async function startup(render: () => void) {
    const localStorageAccessToken = localStorage['access-token'];
    const authorizationCode = new URLSearchParams(window.location.search).get('code');

    if (localStorageAccessToken) {
        const response = await fetch('https://api.example.com/user-credential', { headers: { authorization: 'Bearer ' + localStorageAccessToken } });
        if (response.ok) { accessToken = localStorageAccessToken; render(); return; } // else goto signin
    } else if (!authorizationCode && window.location.pathname.length == 1) { // only display emptyapp when no code and no path
        await new Promise<void>(resolve => root.render(<EmptyPage handleContinue={resolve} />));
    }
    if (!authorizationCode) {
        gotoIdentityProvider();
    } else {
        const url = new URL(window.location.toString());
        url.searchParams.delete('code');
        if (localStorage['return-pathname']) { url.pathname = localStorage['return-pathname']; localStorage.removeItem('return-pathname'); }
        if (localStorage['return-searchparams']) { url.search = localStorage['return-searchparams']; localStorage.removeItem('return-searchparams'); }
        window.history.replaceState(null, '', url.toString());
        const response = await fetch('https://api.example.com/signin', { method: 'POST', headers: { authorization: 'Bearer ' + authorizationCode } });
        if (response.status != 200) { notification('Failed to sign in, how does that happen?'); }
        else { accessToken = localStorage['access-token'] = (await response.json()).accessToken; render(); }
    }
}

let gotoIdModalMaskElement: HTMLDivElement;
let gotoIdModalContainerElement: HTMLDivElement;
let gotoIdModalOKButton: HTMLButtonElement;
let gotoIdModalCancelButton: HTMLButtonElement;
function confirmGotoIdentityProvider() {
    if (!gotoIdModalMaskElement) {
        gotoIdModalMaskElement = document.createElement('div');
        gotoIdModalMaskElement.style = 'position:fixed;inset:0;background-color:#7777;display:none';
        gotoIdModalContainerElement = document.createElement('div');
        gotoIdModalContainerElement.style = 'z-index:100;position:relative;margin:60px auto;padding:12px;'
            + 'border-radius:8px;background-color:white;max-width:320px;box-shadow:3px 3px 10px 4px rgba(0,0,0,0.15);';
        const titleElement = document.createElement('div');
        titleElement.style = 'font-weight:bold;margin-bottom:8px';
        titleElement.innerText = 'CONFIRM';
        const contentElement = document.createElement('div');
        contentElement.innerText = 'Authentication failed, click OK to authenticate again, it is likely to lose unsaved changes, click CANCEL to try again later.';
        const buttonContainerElement = document.createElement('div');
        buttonContainerElement.style = 'display:flex;flex-flow:row-reverse;gap:12px;margin-top:12px';
        gotoIdModalOKButton = document.createElement('button');
        gotoIdModalOKButton.style = 'font-size:14px;border:none;outline:none;cursor:pointer;background:transparent;float:right';
        gotoIdModalOKButton.innerText = 'OK';
        gotoIdModalCancelButton = document.createElement('button');
        gotoIdModalCancelButton.style = 'font-size:14px;border:none;outline:none;cursor:pointer;background:transparent;float:right';
        gotoIdModalCancelButton.innerText = 'CANCEL';
        buttonContainerElement.appendChild(gotoIdModalOKButton);
        buttonContainerElement.appendChild(gotoIdModalCancelButton);
        gotoIdModalContainerElement.appendChild(titleElement);
        gotoIdModalContainerElement.appendChild(contentElement);
        gotoIdModalContainerElement.appendChild(buttonContainerElement);
        document.body.appendChild(gotoIdModalMaskElement);
        document.body.appendChild(gotoIdModalContainerElement);
    }
    const handleCancel = () => {
        gotoIdModalCancelButton.removeEventListener('click', handleCancel);
        gotoIdModalMaskElement.style.display = 'none';
        gotoIdModalContainerElement.style.display = 'none';
    };
    gotoIdModalCancelButton.addEventListener('click', handleCancel);
    const handleOk = () => {
        gotoIdModalOKButton.removeEventListener('click', handleOk);
        localStorage.removeItem('access-token');
        gotoIdentityProvider();
    };
    gotoIdModalOKButton.addEventListener('click', handleOk);
    gotoIdModalMaskElement.style.display = 'block';
    gotoIdModalContainerElement.style.display = 'block';
}

export async function request(method: string, path: string, parameters?: any, data?: any): Promise<any> {
    const url = new URL(`https://api.example.com/example${path}`);
    Object.entries(parameters || {}).forEach(p => url.searchParams.append(p[0], p[1].toString()));
    const response = await fetch(url.toString(), data ? {
        method,
        body: JSON.stringify(data),
        headers: { 'authorization': 'Bearer ' + accessToken, 'content-type': 'application/json' },
    } : { method, headers: { 'authorization': 'Bearer ' + accessToken } });
    if (response.status == 401) { confirmGotoIdentityProvider(); return Promise.reject('Authentication failed.'); }
    // normal/error both return json body, but void do not
    const hasJsonBody = response.headers.has('content-Type') && response.headers.get('content-Type').includes('application/json');
    const responseData = hasJsonBody ? await response.json() : {};
    return response.ok ? Promise.resolve(responseData)
        : response.status >= 400 && response.status < 500 ? Promise.reject(responseData)
        : response.status >= 500 ? Promise.reject({ message: 'internal error' })
        : Promise.reject({ message: 'unknown error' });
}
