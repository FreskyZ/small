/** @jsxImportSource @emotion/react */
import { useState, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { css, keyframes } from '@emotion/react';
import * as I from '../shared/api.js';

function LoadingOutlined() {
    return <svg viewBox="0 0 1024 1024" focusable="false" data-icon="loading" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M988 548c-19.9 0-36-16.1-36-36 0-59.4-11.6-117-34.6-171.3a440.45 440.45 0 00-94.3-139.9 437.71 437.71 0 00-139.9-94.3C629 83.6 571.4 72 512 72c-19.9 0-36-16.1-36-36s16.1-36 36-36c69.1 0 136.2 13.5 199.3 40.3C772.3 66 827 103 874 150c47 47 83.9 101.8 109.7 162.7 26.7 63.1 40.2 130.2 40.2 199.3.1 19.9-16 36-35.9 36z"></path></svg>;
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
function ReloadOutlined() {
    return <svg viewBox="64 64 896 896" focusable="false" data-icon="reload" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M909.1 209.3l-56.4 44.1C775.8 155.1 656.2 92 521.9 92 290 92 102.3 279.5 102 511.5 101.7 743.7 289.8 932 521.9 932c181.3 0 335.8-115 394.6-276.1 1.5-4.2-.7-8.9-4.9-10.3l-56.7-19.5a8 8 0 00-10.1 4.8c-1.8 5-3.8 10-5.9 14.9-17.3 41-42.1 77.8-73.7 109.4A344.77 344.77 0 01655.9 829c-42.3 17.9-87.4 27-133.8 27-46.5 0-91.5-9.1-133.8-27A341.5 341.5 0 01279 755.2a342.16 342.16 0 01-73.7-109.4c-17.9-42.4-27-87.4-27-133.9s9.1-91.5 27-133.9c17.3-41 42.1-77.8 73.7-109.4 31.6-31.6 68.4-56.4 109.3-73.8 42.3-17.9 87.4-27 133.8-27 46.5 0 91.5 9.1 133.8 27a341.5 341.5 0 01109.3 73.8c9.9 9.9 19.2 20.4 27.8 31.4l-60.2 47a8 8 0 003 14.1l175.6 43c5 1.2 9.9-2.6 9.9-7.7l.8-180.9c-.1-6.6-7.8-10.3-13-6.2z"></path></svg>;
}
function CaretRightOutlined() {
    return <svg viewBox="0 0 1024 1024" focusable="false" data-icon="caret-right" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M715.8 493.5L335 165.1c-14.2-12.2-35-1.2-35 18.5v656.8c0 19.7 20.8 30.7 35 18.5l380.8-328.4c10.9-9.4 10.9-27.6 0-37z"></path></svg>;
}
function CopyOutlined() {
    return <svg viewBox="64 64 896 896" focusable="false" data-icon="copy" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M832 64H296c-4.4 0-8 3.6-8 8v56c0 4.4 3.6 8 8 8h496v688c0 4.4 3.6 8 8 8h56c4.4 0 8-3.6 8-8V96c0-17.7-14.3-32-32-32zM704 192H192c-17.7 0-32 14.3-32 32v530.7c0 8.5 3.4 16.6 9.4 22.6l173.3 173.3c2.2 2.2 4.7 4 7.4 5.5v1.9h4.2c3.5 1.3 7.2 2 11 2H704c17.7 0 32-14.3 32-32V224c0-17.7-14.3-32-32-32zM350 856.2L263.9 770H350v86.2zM664 888H414V746c0-22.1-17.9-40-40-40H232V264h432v624z"></path></svg>;
}
function SaveOutlined() {
    return <svg viewBox="64 64 896 896" focusable="false" data-icon="save" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M893.3 293.3L730.7 130.7c-7.5-7.5-16.7-13-26.7-16V112H144c-17.7 0-32 14.3-32 32v736c0 17.7 14.3 32 32 32h736c17.7 0 32-14.3 32-32V338.5c0-17-6.7-33.2-18.7-45.2zM384 184h256v104H384V184zm456 656H184V184h136v136c0 17.7 14.3 32 32 32h320c17.7 0 32-14.3 32-32V205.8l136 136V840zM512 442c-79.5 0-144 64.5-144 144s64.5 144 144 144 144-64.5 144-144-64.5-144-144-144zm0 224c-44.2 0-80-35.8-80-80s35.8-80 80-80 80 35.8 80 80-35.8 80-80 80z"></path></svg>;
}
function BranchOutlined() {
    return <svg viewBox="64 64 896 896" focusable="false" data-icon="branches" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M740 161c-61.8 0-112 50.2-112 112 0 50.1 33.1 92.6 78.5 106.9v95.9L320 602.4V318.1c44.2-15 76-56.9 76-106.1 0-61.8-50.2-112-112-112s-112 50.2-112 112c0 49.2 31.8 91 76 106.1V706c-44.2 15-76 56.9-76 106.1 0 61.8 50.2 112 112 112s112-50.2 112-112c0-49.2-31.8-91-76-106.1v-27.8l423.5-138.7a50.52 50.52 0 0034.9-48.2V378.2c42.9-15.8 73.6-57 73.6-105.2 0-61.8-50.2-112-112-112zm-504 51a48.01 48.01 0 0196 0 48.01 48.01 0 01-96 0zm96 600a48.01 48.01 0 01-96 0 48.01 48.01 0 0196 0zm408-491a48.01 48.01 0 010-96 48.01 48.01 0 010 96z"></path></svg>;
}
function SearchOutlined() {
    return <svg viewBox="64 64 896 896" focusable="false" data-icon="search" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M909.6 854.5L649.9 594.8C690.2 542.7 712 479 712 412c0-80.2-31.3-155.4-87.9-212.1-56.6-56.7-132-87.9-212.1-87.9s-155.5 31.3-212.1 87.9C143.2 256.5 112 331.8 112 412c0 80.1 31.3 155.5 87.9 212.1C256.5 680.8 331.8 712 412 712c67 0 130.6-21.8 182.7-62l259.7 259.6a8.2 8.2 0 0011.6 0l43.6-43.5a8.2 8.2 0 000-11.6zM570.4 570.4C528 612.7 471.8 636 412 636s-116-23.3-158.4-65.6C211.3 528 188 471.8 188 412s23.3-116.1 65.6-158.4C296 211.3 352.2 188 412 188s116.1 23.2 158.4 65.6S636 352.2 636 412s-23.3 116.1-65.6 158.4z"></path></svg>;
}
function CloseOutlined() {
    return <svg fill-rule="evenodd" viewBox="64 64 896 896" focusable="false" data-icon="close" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M799.86 166.31c.02 0 .04.02.08.06l57.69 57.7c.04.03.05.05.06.08a.12.12 0 010 .06c0 .03-.02.05-.06.09L569.93 512l287.7 287.7c.04.04.05.06.06.09a.12.12 0 010 .07c0 .02-.02.04-.06.08l-57.7 57.69c-.03.04-.05.05-.07.06a.12.12 0 01-.07 0c-.03 0-.05-.02-.09-.06L512 569.93l-287.7 287.7c-.04.04-.06.05-.09.06a.12.12 0 01-.07 0c-.02 0-.04-.02-.08-.06l-57.69-57.7c-.04-.03-.05-.05-.06-.07a.12.12 0 010-.07c0-.03.02-.05.06-.09L454.07 512l-287.7-287.7c-.04-.04-.05-.06-.06-.09a.12.12 0 010-.07c0-.02.02-.04.06-.08l57.7-57.69c.03-.04.05-.05.07-.06a.12.12 0 01.07 0c.03 0 .05.02.09.06L512 454.07l287.7-287.7c.04-.04.06-.05.09-.06a.12.12 0 01.07 0z"></path></svg>;
}

// I'm a proffessional user, so I can use complex query syntax
// `name = foo` for name include "foo"
// `tag = bar` for tag include bar, which match tags = [bar, baz], not match tags = [foo, barbaz]
// `name = 'foo bar'` for whitespace/punctuations in search keyword
// `name = foo and tag = bar` and `name = foo or tag = bar` for combined conditions
// `(name = foo or tag = ' bar baz') and (name = brown and (tag = fox or tag = 'jump over'))` for complex conditions
// `not name = foor` and `not tag = 'bar'` for negative condition

type QueryNode = {
    kind: 'condition',
    field: 'name' | 'tag',
    value: string,
} | {
    kind: 'not',
    expr: QueryNode,
} | {
    kind: 'and' | 'or',
    left: QueryNode,
    right: QueryNode,
};

// token can be
// - punctuation: '='
// - parenthesis: '(', ')'
// - keyword or word: 'name', 'tag', 'not', 'foo', 'bar'
// - quoted content is removed quote and regard as single word
function tokenize(queryString: string): string[] {
    const tokens: string[] = [];
    let i = 0;
    while (i < queryString.length) {
        const char = queryString[i];
        if (char == ' ') {
            i++;
        } else if (char == '(' || char == ')' || char == '=') {
            i++;
            tokens.push(char);
        } else if (char == "'" || char == '"') {
            const endIndex = queryString.indexOf(char, i + 1);
            if (endIndex < 0) {
                throw new Error(`invalid syntax: expect end quote from positon ${i}, meet EOL`);
            }
            tokens.push(queryString.substring(i + 1, endIndex));
            i = endIndex + 1; // skip closing quote
        } else {
            const match = /^([\p{L}\d]+)/u.exec(queryString.substring(i));
            if (match) {
                tokens.push(match[0]);
                i += match[0].length;
            } else {
                throw new Error(`invalid syntax: expect word at position ${i}`);
            }
        }
    }
    return tokens;
}

function parsePrimaryExpression(tokens: string[]): QueryNode {
    if (tokens.length == 0) {
        // this seems will not happen after wrapped by parseunaryexpr
        throw new Error(`invalid syntax: expect primary expression, meet EOL`);
    }
    if (tokens[0] == '(') {
        tokens.shift(); // consume '('
        const expr = parseExpression(tokens);
        // @ts-ignore -- tokens have shifted, this is false positive
        if (tokens.length == 0 || tokens[0] != ')') {
            throw new Error('invalid syntax: expect end paren, meet EOL');
        }
        tokens.shift(); // consume ')'
        return expr;
    }
    
    // Parse condition like "name = foo" or "tag = bar"
    if (tokens[0] != 'name' && tokens[0] != 'tag') {
        throw new Error(`invalid syntax: expect name or tag, meet ${tokens[0]}`);
    }
    const field = tokens.shift() as 'name' | 'tag';
    // @ts-ignore -- tokens have shifted, this is false positive, again
    if (tokens[0] != '=') {
        throw new Error(`invalid syntax: expect equal mark, meet ${tokens[0]}`);
    }
    tokens.shift(); // skip equal mark
    // everything at this position is keyword, include '=', '(' and ')'?
    const value = tokens.shift();
    return { kind: 'condition', field, value };
}
function parseUnaryExpression(tokens: string[]): QueryNode {
    if (tokens.length == 0) {
        throw new Error(`invalid syntax: expect unary expression, meet EOL`);
    }
    let not = tokens[0] == 'not';
    if (not) { tokens.shift(); }
    let node = parsePrimaryExpression(tokens);
    return not ? { kind: 'not', expr: node } : node;
}
function parseAndExpression(tokens: string[]): QueryNode {
    let node = parseUnaryExpression(tokens);
    while (tokens.length > 0 && tokens[0] == 'and') {
        tokens.shift(); // consume 'and'
        const right = parseUnaryExpression(tokens);
        node = { kind: 'and', left: node, right };
    }
    return node;
}
function parseOrExpression(tokens: string[]): QueryNode {
    let node = parseAndExpression(tokens);
    while (tokens.length > 0 && tokens[0] == 'or') {
        tokens.shift(); // consume 'or'
        const right = parseAndExpression(tokens);
        node = { kind: 'or', left: node, right };
    }
    return node;
}
function parseExpression(tokens: string[]): QueryNode {
    return parseOrExpression(tokens);
}
// NOTE BLAME this line to find unit test for parseexpr, if you want large change or refactor

function matchQueryNode(item: I.Session, node: QueryNode): boolean {
    if (node.kind == 'condition') {
        if (node.field == 'name') {
            return item.name.toLowerCase().includes(node.value.toLowerCase());
        } else if (node.field == 'tag') {
            return item.tags.some(tag => tag.toLowerCase().includes(node.value.toLowerCase()));
        } else {
            return false; // should be unreachable
        }
    } else if (node.kind == 'not') {
        return !matchQueryNode(item, node.expr);
    } else if (node.kind == 'and') {
        return matchQueryNode(item, node.left) && matchQueryNode(item, node.right);
    } else if (node.kind == 'or') {
        return matchQueryNode(item, node.left) || matchQueryNode(item, node.right);
    } else {
        return false; // should be unreachable
    }
}
function executeQuery(items: I.Session[], queryString: string): I.Session[] {
    if (!queryString.trim()) return items;
    
    const query = parseExpression(tokenize(queryString));
    return items.filter(item => matchQueryNode(item, query));
}

function App() {

    const narrow = window.matchMedia('(max-width: 600px)').matches;
    const [listCollapsed, setListCollapsed] = useState(narrow);
    const [infoCollapsed, setInfoCollapsed] = useState(true);

    const styles0 = useMemo(() => createPageStyles(), []);
    const styles1 = useMemo(() => createMainStyles(), []);
    const styles2 = useMemo(() => createInfoStyles(infoCollapsed), [infoCollapsed]);
    const styles3 = useMemo(() => createListStyles(infoCollapsed), [infoCollapsed]);
    const styles4 = useMemo(() => createModalStyles(), []);

    // this list does not include messages    
    const [sessions, setSessions] = useState<I.Session[]>([]);
    const [queryString, setQueryString] = useState<string>('');
    const [accountBalance, setAccountBalance] = useState<number>(null);
    // only update this when clicking apply
    const [displaySessions, setDisplaySessions] = useState<I.Session[]>([]);

    const [modalOpen, setModalOpen] = useState(false);

    // current selected session id, null for not selected (new session)
    const [sessionId, setSessionId] = useState(null);
    const [editingSessionName, setEditingSessionName] = useState('');
    const [editingComment, setEditingComment] = useState('');
    const [editingTags, setEditingTags] = useState('');
    // current selected session's all messages
    // TODO distinguish editing content
    const [messages, setMessages] = useState<I.Message[]>([]);
    // current displaying message id path
    const [messagePath, setMessagePath] = useState<number[]>([]);

    useEffect(() => {
        (async () => {
            // TODO add error message display on all api invocations
            const sessions = await api.getSessions();
            setSessions(sessions);
            setDisplaySessions(sessions);
            const maybeSessionId = parseInt(window.location.pathname.substring(1));
            if (!isNaN(maybeSessionId) && maybeSessionId > 0 && sessions.some(s => s.id == maybeSessionId)) {
                handleSelectSession(maybeSessionId);
            } else {
                const url = new URL(window.location.toString());
                url.pathname = '/';
                window.history.replaceState(null, '', url.toString());
            }
        })();
    }, []);

    const handleQuery = () => {
        try {
            setDisplaySessions(executeQuery(sessions, queryString));
        } catch (error) {
            notification('failed to search: ' + error.message);
        }
    };
    const handleClearQuery = () => {
        setQueryString('');
        setDisplaySessions(sessions);
    };
    useEffect(() => {
        setQueryString('');
        setDisplaySessions(sessions);
    }, [sessions]);

    const handleReloadAccountBalance = async () => {
        const result = await api.getAccountBalance();
        setAccountBalance(result.balance);
    };


    const handleAddSession = async () => {
        const result = await api.addSession({} as I.Session);
        setSessions([result].concat(sessions));
        // TODO id is not added to url after adding
        setSessionId(result.id);
        setMessages(result.messages);
        setMessagePath([result.messages[0].id]);
    };
    const handleDeleteSession = async (sessionId: number) => {
        if (confirm('delete session?')) {
            await api.removeSession(sessionId);
        }
    };

    const handleSelectSession = async (sessionId: number) => {
        setInfoCollapsed(true);
        // TODO update session properties when selecting session (name, comment, tags, shared)
        const messages = (await api.getSession(sessionId)).messages;
        // session's message list cannot be empty, so this find must have result
        const messagePath: number[] = [messages.find(m => !m.parentId).id];
        while (messages.some(m => m.parentId == messagePath[messagePath.length - 1])) {
            messagePath.push(messages.find(m => m.parentId == messagePath[messagePath.length - 1]).id);
        }
        setSessionId(sessionId);
        setMessages(messages);
        setMessagePath(messagePath);

        const url = new URL(window.location.toString());
        url.pathname = `/${sessionId}`;
        window.history.pushState(null, '', url.toString());
    };

    const handleUpdateSession = async (sessionId: number) => {
        // trim and remove empty entry
        session.tags = session.tags.map(t => t.trim()).filter(t => t);
        await api.updateSession(sessions.find(s => s.id == sessionId));
        setSessions([...sessions]);
        notification(`saved successfully`);
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
    const handleShareLinkCopy = () => {
        if (session.shareId) {
            navigator.clipboard.writeText(`https://chat.example.com/share/${session.shareId}`);
            notification('Copied to clipboard!');
        }
    };

    // NOTE before editing state, try auto height for all textareas while messages/messagePath change
    // useLayoutEffect(() => {
    //     const container = document.querySelector<HTMLDivElement>('div#session-content-container');
    //     const wasAtBottom = !container ? false : container.clientHeight + container.scrollTop >= container.scrollHeight - 10;
    //     document.querySelectorAll<HTMLTextAreaElement>('textarea.major-content').forEach(e => {
    //         e.style.height = '8px'; // if you don't shrink them, they will become higher and higher when rendering
    //         e.style.height = e.scrollHeight + 'px';
    //     });
    //     if (wasAtBottom) {
    //         container.scrollTo({ top: container.scrollHeight - container.clientHeight });
    //     }
    // }, [messages, messagePath]);

    // to make things simple, add message directly add to db
    const handleAddMessage = async () => {
        const lastMessage = messages.find(m => m.id == messagePath[messagePath.length - 1]);
        const newRole = lastMessage.role == 'system' || lastMessage.role == 'assistant' ? 'user' : 'assistant';
        const result = await api.addMessage(sessionId, { id: 0, parentId: lastMessage.id, role: newRole, content: '' });
        setMessages(messages.concat(result));
        setMessagePath(messagePath.concat(result.id));
    };
    const handleNavigateBranch = (message: I.Message, next: boolean) => {
        const siblings = messages.filter(m => m.parentId == message.parentId).map(m => m.id);
        const newMessageId = siblings[siblings.indexOf(message.id) + (next ? 1 : -1)];
        const newMessagePath = messagePath.slice(0, messagePath.indexOf(message.id)).concat(newMessageId);
        while (messages.some(m => m.parentId == newMessagePath[newMessagePath.length - 1])) {
            newMessagePath.push(messages.find(m => m.parentId == newMessagePath[newMessagePath.length - 1]).id);
        }
        setMessagePath(newMessagePath);
    };
    const handleUpdateMessage = async (message: I.Message) => {
        await api.updateMessage(sessionId, message);
        notification('save edit successfully');
    };
    const handleBranchMessage = async (message: I.Message) => {
        // directly use the current message to call addmessage is enough for branch message
        const result = await api.addMessage(sessionId, message);
        setMessages(messages.concat(result));
        setMessagePath(messagePath.slice(0, messagePath.indexOf(message.id)).concat(result.id));
        notification('branch message successfully');
    };
    const handleDeleteMessage = async (messageId: number) => {

        // if have sibiling, place a sibling at current path
        let currentPositionNewMessageId: number;
        const message = messages.find(m => m.id == messageId);
        const siblings = messages.filter(m => m.parentId == message.parentId).map(m => m.id);
        if (siblings.length > 1) {
            const siblingIndex = siblings.indexOf(message.id);
            // index in siblings array for the message to place at this to-be-delete message's position
            // if have previous options, go to prev, else goto next (which is 1)
            const newSiblingIndex = siblingIndex > 0 ? siblingIndex - 1 : 1;
            currentPositionNewMessageId = siblings[newSiblingIndex];
        }

        if (confirm('delete this and following message?')) {
            await api.removeMessageTree(sessionId, messageId);
        }
        let newMessages = messages.filter(m => m.id != messageId);
        let beforeLoopMessagesLength = newMessages.length;
        while (true) {
            newMessages = newMessages.filter(m1 => !m1.parentId || newMessages.some(m2 => m2.id == m1.parentId));
            if (beforeLoopMessagesLength == newMessages.length) { break; }
            beforeLoopMessagesLength = newMessages.length;
        }

        const newMessagePath = messagePath.slice(0, messagePath.indexOf(messageId));
        if (currentPositionNewMessageId) { newMessagePath.push(currentPositionNewMessageId); }
        // and find messages follow current message path tail
        while (newMessages.some(m => m.parentId == newMessagePath[newMessagePath.length - 1])) {
            newMessagePath.push(newMessages.find(m => m.parentId == newMessagePath[newMessagePath.length - 1]).id);
        }
        // console.log('delete message, result', { newMessages, newMessagePath });
        setMessages(newMessages);
        setMessagePath(newMessagePath);
    };

    const handleCompleteMessage = async (messageId: number) => {
        const result = await api.completeMessage(sessionId, messageId);
        // TODO messagepath is not displayed correctly
        setMessages(messages.concat(result));
        setMessagePath(messagePath.slice(0, messagePath.find(m => m == messageId) + 1).concat(result.id));
    };

    // for now, only for pc browser
    // the layout structure is page title => content/new => header => list, which represents the z index without specifying zindex property
    // TODO real layered structure for mobile browser

    const session = sessions.find(s => s.id == sessionId);
    return <div css={styles0.page}>
        <div css={styles1.headerContainer}>
            {sessionId && <span css={styles1.sessionNameContainer} onClick={() => setInfoCollapsed(!infoCollapsed)}>
                <span css={styles1.sessionName}>{session.name}</span>
                <button css={styles1.collapseButton} title='Collapse'><CaretRightOutlined /></button>
            </span>}
        </div>
        {session ? <div css={styles1.sessionContentContainer}>
            {messagePath.map(mid => messages.find(m => m.id == mid)).map((m, i) => <div key={i} css={styles1.messageContainer}>
                <div css={styles1.messageHeader}>
                    <span css={styles1.role}>{m.role.toUpperCase()}</span>
                    {messages.filter(a => a.parentId == m.parentId).map(a => a.id).length > 1 && <button
                        css={[styles1.headerButton, styles1.prevButton]} title="Prev"
                        disabled={messages.filter(a => a.parentId == m.parentId).map(a => a.id).indexOf(m.id) == 0}
                        onClick={() => handleNavigateBranch(m, false)}><CaretRightOutlined /></button>}
                    {messages.filter(a => a.parentId == m.parentId).map(a => a.id).length > 1 && <span css={styles1.pageDisplay}>
                        {messages.filter(a => a.parentId == m.parentId).map(a => a.id).indexOf(m.id) + 1}/{messages.filter(a => a.parentId == m.parentId).map(a => a.id).length}</span>}
                    {messages.filter(a => a.parentId == m.parentId).map(a => a.id).length > 1 && <button
                        css={styles1.headerButton} title='Next'
                        disabled={messages.filter(a => a.parentId == m.parentId).map(a => a.id).indexOf(m.id) == messages.filter(a => a.parentId == m.parentId).map(a => a.id).length - 1}
                        onClick={() => handleNavigateBranch(m, true)}><CaretRightOutlined /></button>}
                    {/* TODO change to dotdotdot popup menu in mobile page */}
                    {/* TODO copy content button */}
                    <button css={styles1.headerButton}
                        title='Save current edit in this message record'
                        onClick={() => handleUpdateMessage(m)}><SaveOutlined />EDIT</button>
                    <button css={styles1.headerButton}
                        title='Use current edit to branch message tree from parent message'
                        onClick={() => handleBranchMessage(m)}><BranchOutlined />BRANCH</button>
                    {m.role == 'user' && <button css={styles1.headerButton}
                        title='Complete this' onClick={() => handleCompleteMessage(m.id)}><CaretRightOutlined />COMPLETE</button>}
                </div>
                {/* TODO https://marked.js.org/#usage */}
                {/* TODO https://github.com/remarkjs/react-markdown, NOTE react-markdown don't support ai's latex syntax, need something like const preprocessLaTeX = (content: string) => {
                    // Replace block-level LaTeX delimiters \[ \] with $$ $$  
                    const blockProcessedContent = content.replace(
                        /\\\[(.*?)\\\]/gs,
                        (_, equation) => `$$${equation}$$`,
                    );
                    // Replace inline LaTeX delimiters \( \) with $ $
                    const inlineProcessedContent = blockProcessedContent.replace(
                        /\\\((.*?)\\\)/gs,
                        (_, equation) => `$${equation}$`,
                    );
                    return inlineProcessedContent;
                    }; also see https://github.com/remarkjs/react-markdown/issues/785 */}
                <textarea className='major-content' css={styles1.textarea} value={m.content}
                    onChange={e => { m.content = e.target.value; setMessages([...messages]) }} />
                <div css={styles1.messageHeader}>
                    <span>#{m.id}</span>
                    <span>{m.createTime}</span>
                    {!!m.promptTokenCount && !!m.completionTokenCount && <span>{m.promptTokenCount}/{m.completionTokenCount}</span>}
                    <button css={styles1.headerButton} onClick={() => handleDeleteMessage(m.id)}><DeleteOutlined />DELETE</button>
                </div>
            </div>)}
            <div>
                <button onClick={handleAddMessage}>ADD</button>
            </div>
        </div> : <div css={styles1.newSessionContainer}>
            <div>Start new chat</div>
            <input css={styles1.newSessionTitle}></input>
            <textarea></textarea>
            <button>SEND</button>
        </div>}
        {/* this is floating on normal screen and a layer on narrow screen */}
        {sessionId && <div css={styles2.sessionInfoContainer}>
            <span css={styles2.label}>Name</span>
            <input value={session.name} onChange={e => { session.name = e.target.value; setSessions([...sessions]); }} />
            <span css={styles2.label}>Comment</span>
            <textarea value={session.comment ?? ''} onChange={e => { session.comment = e.target.value; setSessions([...sessions]); }} />
            <span css={styles2.label}>Tags</span>
            <input value={session.tags.join(',')} onChange={e => { session.tags = e.target.value.split(','); setSessions([...sessions]); }} />
            <span css={styles2.saveLine}>
                <span css={styles2.label}>Created at {session.createTime}</span>
                <button css={styles2.saveButton} onClick={() => handleUpdateSession(sessionId)}>SAVE</button>
            </span>
            <span css={styles2.shareLine}>
                <button title={session.shareId ? 'Unshare' : 'Share'} onClick={handleShareClick}><ShareOutlined /></button>
                {/* TODO make this <a> */}
                <input value={session.shareId ? `https://chat.example.com/share/${session.shareId}` : ''} readOnly={true} />
                {!!session.shareId && <button title="Copy to Clipboard" onClick={() => handleShareLinkCopy()}><CopyOutlined /></button>}
            </span>
        </div>}
        {/* this is floating on normal screen and a layer on narrow screen */}
        <div css={styles3.listContainer}>
            <div>
                <button css={styles3.addButton} onClick={() => handleSelectSession(null)}>New Chat</button>
            </div>
            <div css={styles3.queryContainer}>
                <input css={styles3.queryString} value={queryString}
                    onKeyUp={e => { if (e.key == 'Enter') { handleQuery(); } } } onChange={e => setQueryString(e.target.value)} />
                <button title='Clear search' css={styles3.queryButton} onClick={handleClearQuery}><CloseOutlined /></button>
                <button title='Search' css={styles3.queryButton} onClick={handleQuery}><SearchOutlined /></button>
            </div>
            <div css={styles3.itemsContainer}>
                {displaySessions.map(s => <div key={s.id} css={[styles3.listItem, sessionId == s.id && styles3.activeItem]}>
                    <span onClick={() => handleSelectSession(s.id)}>{s.name}</span>
                    <button title="Delete" onClick={() => handleDeleteSession(s.id)}><DeleteOutlined /></button>
                </div>)}
            </div>
        </div>
        <button css={styles3.collapseButton} title='Collapse' onClick={() => setListCollapsed(!listCollapsed)}><MenuFoldOutlined /></button>
        {/* TODO change to another popup menu trigger from right bottom corner */}
        {modalOpen && <div css={styles4.modalMask} onClick={() => setModalOpen(false)}></div>}
        {modalOpen && <div css={styles4.modalContainer}>
            <a href="https://github.com/freskyz/small/tree/main/theai">https://github.com/freskyz/small/tree/main/theai</a>
            <div css={styles4.listFooter}>
                <button css={styles4.loadButton} onClick={handleReloadAccountBalance} title="Click to Check Balance"><ReloadOutlined /></button>
                <span>Balance: {accountBalance ?? '?'}</span>
            </div>
            <input id="dark-mode" type="checkbox"></input>
            {/* TODO // https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/light-dark */}
            <label htmlFor="dark-mode">Dark Mode</label>
        </div>}
    </div>;
}

// becomes styles0, currently only the page container
const createPageStyles = () => ({
    page: css({
    }),
});

// becomes style1, main header and content styles
const createMainStyles = () => ({

    headerContainer: css({
        display: 'flex',
        flexFlow: 'column',
        alignItems: 'center',
        height: '50px',
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
        // rotate: collapsed ? '90deg' : '-90deg',
        // transformOrigin: '13px 9px',
    }),
    sessionContentContainer: css({
        overflowX: 'hidden',
        overflowY: 'auto',
        // width: listCollapsed ? 'calc(100vw - 20px)' : 'calc(100vw - 300px)',
        maxWidth: '800px',
        // maxHeight: infoCollapsed ? 'calc(100vh - 60px)' : 'calc(100vh - 360px)',
    }),
    messagesContainer: css({
        // width: listCollapsed ? 'calc(100vw - 20px)' : 'calc(100vw - 300px)',
        marginTop: '-50px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
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
    completeButton: css({
        // this should be a major button so a dedicated style
        // but seems this is not major button in current design
    }),
    textarea: css({
        resize: 'vertical',
        width: 'calc(100% - 16px)',
    }),
    newSessionContainer: css({

    }),
    newSessionTitle: css({

    }),
});

// becomes styles2, session info panel
const createInfoStyles = (collapsed: boolean) => ({
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
    saveLine: css({
        marginTop: '4px',
    }),
    saveButton: css({
        background: 'transparent',
        border: 'none',
        outline: 'none',
        borderRadius: '4px',
        fontSize: '16px',
        padding: '4px 12px 2px 12px',
        float: 'right',
        cursor: 'pointer',
        '&:hover': {
            background: '#ccc',
        },
    }),
    shareLine: css({
        display: 'flex',
        gap: '4px',
        marginTop: '4px',
        button: {
            background: 'transparent',
            border: 'none',
            outline: 'none',
            borderRadius: '4px',
            fontSize: '14px',
            padding: '6px 4px 2px 4px',
            cursor: 'pointer',
            '&:hover': {
                background: '#ccc',
            },
        },
        input: {
            width: '100%',
        },
    }),
});

// becomes styles3, session list panel
const createListStyles = (collapsed: boolean) => ({
    listContainer: css({
        position: 'fixed',
        top: 0,
        right: /*collapsed ? '-280px' :*/ 0,
        height: '100vh',
        width: '280px',
        background: '#e7e7e7',
        padding: '12px 0 12px 12px',
        boxSizing: 'border-box',
        transition: 'right 0.2s',
        // backup in case you need this
        // '@media (max-width: 600px)': {},
    }),
    collapseButton: css({
        position: 'fixed',
        top: '12px',
        right: '12px',
        border: 'none',
        background: 'none',
        padding: '10px 11px 5px 11px',
        borderRadius: '6px',
        cursor: 'pointer',
        fontSize: '16px',
        color: '#333',
        rotate: collapsed ? '0' : '180deg',
        '&:hover': {
            background: '#ccc',
        },
    }),
    queryContainer: css({
        display: 'flex',
        gap: '4px',
        marginTop: '8px',
        height: '28px',
    }),
    queryString: css({
        border: 'none',
        borderBottom: '1px solid gray',
        height: '24px',
        width: '188px',
        background: 'transparent',
    }),
    queryButton: css({
        height: '28px',
        padding: '8px',
        fontSize: '12px',
        color: '#333',
        background: 'transparent',
        border: 'none',
        borderRadius: '4px',
        cursor: 'pointer',
        '&:hover': {
            background: '#ccc', 
        }
    }),
    itemsContainer: css({
        marginTop: '12px',
        height: 'calc(100vh - 128px)',
        overflowX: 'hidden',
        overflowY: 'auto',
        borderWidth: '1px 0',
        borderStyle: 'solid',
        borderColor: 'lightgray',
    }),
    addButton: css({
        padding: '8px 16px',
        fontSize: '16px',
        fontWeight: 'bold',
        color: '#333',
        backgroundColor: '#ccc',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(40, 46, 56, 0.15)',
        transition: 'background 0.2s, box-shadow 0.2s',
        '&:hover': {
            boxShadow: '0 3px 12px rgba(68, 74, 87, 0.25)',
        },
    }),
    listItem: css({
        width: '248px',
        borderRadius: '8px',
        padding: '0 0 0 8px',
        height: '36px',
        cursor: 'pointer',
        marginLeft: '-2px',
        display: 'flex',
        'span': {
            lineHeight: '36px',
            width: '212px',
            display: 'inline-block',
            textOverflow: 'ellipsis',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
        },
        'button': {
            display: 'none',
            border: 'none',
            background: 'none',
            padding: '9px 11px 4px 11px',
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
    activeItem: css({
        background: '#ccc',
        'button': {
            display: 'inline',
        }
    }),
});

// become styles4, system modal
const createModalStyles = () => ({
    modalMask: css({
        position: 'fixed',
        inset: 0,
        backgroundColor: '#77777733',
    }),
    modalContainer: css({
        background: '#eee',
        position: 'absolute',
        margin: '50px auto',
        borderRadius: '8px',
    }),
    listFooter: css({
        display: 'flex',
        height: '24px',
        'span': {
            cursor: 'default',
            fontSize: '12px',
            lineHeight: '24px',
        }
    }),
    loadButton: css({
        height: '24px',
        padding: '4px',
        fontSize: '12px',
        color: '#333',
        background: 'transparent',
        border: 'none',
        borderRadius: '4px',
        cursor: 'pointer',
        marginLeft: '8px',
        '&:hover': {
            background: '#aaa',
        }
    }),
});

// TODO startup process
// if no access token and no code query parameter:
//    display and empty page with a continue button, wait for continue button
// if has access token:
//    try get user credentials
//    if get user credentials:
//       goto render
// if no code query parameter:
//    goto id.example.com?return
// if has code query parameter:
//    sign in and render, display a sign in failure content if sign in failed

// if api get 401:
//    wait for confirm continue
//    goto id.example.com?return

const emptytext = "What draws you here - chance or curiosity? And what sends you away - emptiness or the whisper of something unseen? Like a door ajar in the wind, this space may beckon or repel, yet who can say if arrival or departure holds more meaning? To stay is to touch the unknown; to go is to carry its shadow. Perhaps the truest contact is the absence of answers, the silent exchange between seeker and void. And if you reach out, do you seek me, or the echo of your own unanswered questions? In the end, is any path but a circle?";
const root = createRoot(document.querySelector('main'));
startup(() => root.render(<App />));

// AUTOGEN
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
    }
    window.location.assign('https://id.example.com?return=https://chat.example.com');
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
    const url = new URL(`https://api.example.com/yala${path}`);
    Object.entries(parameters || {}).forEach(p => url.searchParams.append(p[0], p[1].toString()));
    const response = await fetch(url.toString(), data ? {
        method,
        body: JSON.stringify(data),
        headers: { 'authorization': 'Bearer ' + accessToken, 'content-type': 'application/json' },
    } : { method, headers: { 'authorization': 'Bearer ' + accessToken } });
    if (response.status == 401) { confirmGotoIdentityProvider(); return; }
    // normal/error both return json body, but void do not
    const hasJsonBody = response.headers.has('content-Type') && response.headers.get('content-Type').includes('application/json');
    const responseData = hasJsonBody ? await response.json() : {};
    return response.ok ? Promise.resolve(responseData)
        : response.status >= 400 && response.status < 500 ? Promise.reject(responseData)
        : response.status >= 500 ? Promise.reject({ message: 'internal error' })
        : Promise.reject({ message: 'unknown error' });
}
const api = {
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
    getAccountBalance: (): Promise<I.AccountBalance> => sendRequest('GET', '/v1/account-balance'),
};
