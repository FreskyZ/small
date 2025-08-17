/** @jsxImportSource @emotion/react */
import { css } from '@emotion/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import type * as I from '../shared/api-types.js';
import { notification } from './notification.js';
import { makeapi } from './api.js';
import { startup } from './startup.js';

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
        const pageId = parseInt(new URL(window.location.href).searchParams.get("id"));
        api.getPage(pageId || 1).then(result => {
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

    return <>
        <button css={styles1.saveButton} onClick={handleSave}>SAVE</button>
        <div css={styles1.editorAndMarkdownContainer}>
            <textarea
                css={styles1.editorContainer}
                value={editingContent}
                onChange={e => setEditingContent(e.target.value)} />
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

const placeholderText
    = "What draws you here - chance or curiosity? And what sends you away - emptiness or the whisper of something unseen? "
    + "Like a door ajar in the wind, this space may beckon or repel, yet who can say if arrival or departure holds more meaning? "
    + "To stay is to touch the unknown; to go is to carry its shadow. Perhaps the truest contact is the absence of answers, "
    + "the silent exchange between seeker and void. And if you reach out, do you seek me, or the echo of your own unanswered questions? In the end, is any path but a circle?";
const api = await startup(document.querySelector('main'), document.querySelector('div#auth-modal-root'), placeholderText, () => <App />, 'yama', makeapi);
