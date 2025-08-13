/** @jsxImportSource @emotion/react */
import { createRoot } from 'react-dom/client';
import { css } from '@emotion/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Editor from 'react-simple-code-editor';
import Markdown from 'react-markdown';
import * as I from '../shared/api.js';

// note content is one markdown document
// it supports basic formatting, tables, external links
// and special external links to my drive's file, audio and video
// it supports share like note.freskyz.com/share/shareid in readonly mode

// code highlight maybe need this https://highlightjs.org/, if markdown library does not support syntax highlighting
// add a <clipboard> element that add a container and allows copy to clipboard
// TODO don't forget auto save

function App() {
    const styles1 = useMemo(() => createMainStyles(), []);

    const [page, setPage] = useState<I.Page>(null);
    const [editingContent, setEditingContent] = useState('');

    useEffect(() => {
        api.getPage(1).then(result => {
            setPage(result);
            setEditingContent(result.content);
        }, error => {
            notification(error?.message ?? 'Something went wrong.');
        });
    }, []);

    const handleSave = useCallback(() => {
        const newPage = { ...page, content: editingContent };
        api.updatePage(newPage).then(() => {
            setPage(newPage);
            notification('Saved successfully.');
        }, error => {
            notification(error?.message ?? 'Something went wrong.');
        });
    }, [page, editingContent]);

    const WhyDontYouTypeCheckEditor = Editor as any;
    return <>
        <button css={styles1.saveButton} onClick={handleSave}>SAVE</button>
        <div css={styles1.editorAndMarkdownContainer}>
            <WhyDontYouTypeCheckEditor
                css={styles1.editorContainer}
                padding={8}
                value={editingContent}
                onValueChange={(newValue: string) => setEditingContent(newValue)}
                highlight={(v: string) => v} />
            <div css={styles1.markdownContainer}>
                <Markdown>{editingContent}</Markdown>
            </div>
        </div>
        <span>{page?.updateTime}</span>
    </>;
}
const createMainStyles = () => ({
    saveButton: css({
        marginLeft: '300px',
    }),
    editorAndMarkdownContainer: css({
        marginTop: '50px',
        width: 'calc(100vw - 24px)',
        // TODO seems not work with this
        height: 'calc(100vh - 72px)',
        overflow: 'hidden',
        display: 'flex',
        gap: '8px',
    }),
    editorContainer: css({
        width: 'calc(50vw - 32px)',
    }),
    markdownContainer: css({
        width: 'calc(50vw - 32px)',
    }),
});

const root = createRoot(document.querySelector('main'));
startup(() => root.render(<App />));
const emptytext = "What draws you here - chance or curiosity? And what sends you away - emptiness or the whisper of something unseen? Like a door ajar in the wind, this space may beckon or repel, yet who can say if arrival or departure holds more meaning? To stay is to touch the unknown; to go is to carry its shadow. Perhaps the truest contact is the absence of answers, the silent exchange between seeker and void. And if you reach out, do you seek me, or the echo of your own unanswered questions? In the end, is any path but a circle?";

// AUTOGEN 55141d2e10bbde76e184778c82e97fd6620b9aa7214d786849da6da4a1cbd1e1
// --------------------------------------
// ------ ATTENTION AUTO GENERATED ------
// --------------------------------------

let notificationTimer: any;
let notificationElement: HTMLSpanElement;
function notification(message: string) {
    if (!notificationElement) {
        const container = document.createElement('div');
        container.style = 'position:fixed;inset:0;text-align:center;cursor:default;pointer-events:none';
        notificationElement = document.createElement('span');
        notificationElement.style = 'padding:8px;background-color:white;margin-top:4em;'
            + 'display:none;border-radius:4px;box-shadow:3px 3px 10px 4px rgba(0,0,0,0.15);max-width:320px';
        container.appendChild(notificationElement);
        document.body.appendChild(container);
    }
    if (notificationTimer) {
        clearTimeout(notificationTimer);
    }
    notificationElement.style.display = 'inline-block';
    notificationElement.innerText = message;
    notificationTimer = setTimeout(() => { notificationElement.style.display = 'none'; }, 10_000);
}

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

async function sendRequest(method: string, path: string, parameters?: any, data?: any): Promise<any> {
    const url = new URL(`https://api.example.com/yama${path}`);
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
const api = {
    getBooks: (): Promise<I.Book[]> => sendRequest('GET', '/v1/books'),
    getBook: (bookId: number): Promise<I.Book> => sendRequest('GET', '/v1/book', { bookId }),
    addBook: (data: I.Book): Promise<I.Book> => sendRequest('PUT', '/v1/add-book', {}, data),
    updateBook: (data: I.Book): Promise<I.Book> => sendRequest('POST', '/v1/update-book', {}, data),
    removeBook: (bookId: number): Promise<void> => sendRequest('DELETE', '/v1/remove-book', { bookId }),
    addSection: (bookId: number, sectionId: number | undefined): Promise<I.Section> => sendRequest('PUT', '/v1/add-section', { bookId, sectionId }),
    updateSection: (bookId: number, data: I.Section): Promise<I.Section> => sendRequest('POST', '/v1/update-section', { bookId }, data),
    moveSection: (bookId: number, sectionId: number, newParentId: number | undefined): Promise<void> => sendRequest('POST', '/v1/move-section', { bookId, sectionId, newParentId }),
    removeSection: (bookId: number, sectionId: number): Promise<void> => sendRequest('DELETE', '/v1/remove-section', { bookId, sectionId }),
    getPage: (pageId: number): Promise<I.Page> => sendRequest('GET', '/v1/page', { pageId }),
    addPage: (bookId: number, sectionId: number | undefined, data: I.Page): Promise<I.Page> => sendRequest('PUT', '/v1/add-page', { bookId, sectionId }, data),
    updatePage: (data: I.Page): Promise<I.Page> => sendRequest('POST', '/v1/update-page', {}, data),
    movePage: (pageId: number, newSectionId: number | undefined): Promise<void> => sendRequest('POST', '/v1/move-page', { pageId, newSectionId }),
    sharePage: (pageId: number): Promise<I.SharePageResult> => sendRequest('POST', '/v1/share-page', { pageId }),
    unsharePage: (pageId: number): Promise<void> => sendRequest('POST', '/v1/unshare-page', { pageId }),
    removePage: (pageId: number): Promise<void> => sendRequest('DELETE', '/v1/remove-page', { pageId }),
    getPageHistories: (pageId: number): Promise<I.PageHistory[]> => sendRequest('GET', '/v1/page-histories', { pageId }),
    getPageHistory: (historyId: number): Promise<I.PageHistory> => sendRequest('GET', '/v1/page-history', { historyId }),
    savePageVersion: (pageId: number, data: I.PageHistory): Promise<I.PageHistory> => sendRequest('POST', '/v1/save-page-version', { pageId }, data),
    restorePageVersion: (pageId: number, historyId: number): Promise<I.Page> => sendRequest('POST', '/v1/restore-page-version', { pageId, historyId }),
    removePageVersion: (historyId: number): Promise<void> => sendRequest('DELETE', '/v1/remove-page-version', { historyId }),
    getPageFiles: (pageId: number): Promise<I.EmbeddedFile[]> => sendRequest('GET', '/v1/page-files', { pageId }),
    getPageFile: (fileId: number): Promise<I.EmbeddedFile> => sendRequest('GET', '/v1/page-file', { fileId }),
    addPageFile: (pageId: number, data: I.EmbeddedFile): Promise<I.EmbeddedFile> => sendRequest('PUT', '/v1/add-page-file', { pageId }, data),
    updatePageFile: (data: I.EmbeddedFile): Promise<I.EmbeddedFile> => sendRequest('POST', '/v1/update-page-file', {}, data),
    removePageFile: (fileId: number): Promise<void> => sendRequest('DELETE', '/v1/remove-page-file', { fileId }),
    search: (data: I.Query): Promise<I.QueryResult> => sendRequest('POST', '/v1/search', {}, data),
};
