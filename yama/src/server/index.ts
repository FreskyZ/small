import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import mysql from 'mysql2/promise';
import * as I from '../shared/api.js';
import * as D from './database.js';
import type { MyErrorKind, ActionContext, DispatchContext, DispatchResult } from './dispatch.js';

dayjs.extend(utc);
// this is the same config file as core module
const config = JSON.parse(await fs.readFile('config', 'utf-8')) as {
    // so this is the connection options to connect to core module database
    database: mysql.PoolOptions,
};

type QueryResult<T> = T & mysql.RowDataPacket;
type ManipulateResult = mysql.ResultSetHeader;
// so need to change database name to connect to this app's database
const pool = mysql.createPool({ ...config.database, database: 'YAMA', typeCast: (field, next) =>
    field.type == 'BIT' && field.length == 1 ? field.buffer()[0] == 1
    : field.type == 'DATETIME' ? dayjs.utc(field.string(), 'YYYY-MM-DD hh:mm:ss')
    : next(),
});

function formatDateTime(value: dayjs.Dayjs) {
    return value.format('YYYY-MM-DDTHH:mm:ss[Z]');
}

async function validateBookUser(ax: ActionContext, bookId: number) {
    const [books] = await pool.query<QueryResult<D.Book>[]>(
        'SELECT `BookId` FROM `Book` WHERE `BookId` = ? AND `UserId` = ?',
        [bookId, ax.userId],
    );
    if (!Array.isArray(books) || books.length == 0) {
        throw new MyError('not-found', 'invalid book id');
    }
}
// return bookid
async function validatePageUser(ax: ActionContext, pageId: number): Promise<number> {
    const [pages] = await pool.query<QueryResult<D.Page>[]>(
        'SELECT `PageId`, `Book`.`BookId` FROM `Page` JOIN `Book` ON `Page`.`BookId` = `Book`.`BookId` WHERE `PageId` = ? AND `Book`.`UserId` = ?',
        [pageId, ax.userId],
    );
    if (!Array.isArray(pages) || pages.length == 0) {
        throw new MyError('not-found', 'invalid page id');
    }
    return pages[0].BookId;
}

async function getBooks(ax: ActionContext): Promise<I.Book[]> {
    return [];
}

async function getBook(ax: ActionContext, bookId: number): Promise<I.Book> {
    return null;
}

async function addBook(ax: ActionContext, body: I.Book): Promise<I.Book> {
    return null;
}

async function updateBook(ax: ActionContext, body: I.Book): Promise<I.Book> {
    return null;
}

async function removeBook(ax: ActionContext, bookId: number): Promise<void> {
}

async function addSection(ax: ActionContext, bookId: number, sectionId: number): Promise<I.Section> {
    return null;
}

async function updateSection(ax: ActionContext, bookId: number, body: I.Section): Promise<I.Section> {
    return null;
}

async function moveSection(ax: ActionContext, bookId: number, sectionId: number, newParentId: number): Promise<void> {
}

async function removeSection(ax: ActionContext, bookId: number, sectionId: number): Promise<void> {
}

async function getPage(ax: ActionContext, pageId: number): Promise<I.Page> {

    await validatePageUser(ax, pageId);
    const [[page]] = await pool.query<QueryResult<D.Page>[]>(
        'SELECT `PageId`, `Name`, `Content`, `CreateTime`, `UpdateTime` FROM `Page` WHERE `PageId` = ?',
        [pageId],
    );

    return {
        id: page.PageId,
        name: page.Name,
        content: page.Content,
        createTime: formatDateTime(page.CreateTime),
        updateTime: formatDateTime(page.UpdateTime),
        files: [],
    };
}

async function publicGetPage(ax: ActionContext, shareId: string): Promise<I.Page> {
    return null;
}

async function addPage(ax: ActionContext, bookId: number, sectionId: number, body: I.Page): Promise<I.Page> {
    return null;
}

async function updatePage(ax: ActionContext, page: I.Page): Promise<I.Page> {

    if (!page.name) {
        throw new MyError('common', 'invalid page name');
    }
    const bookId = await validatePageUser(ax, page.id);

    // NOTE page name name should not duplicate in book
    const [existingPages] = await pool.query<QueryResult<D.Page>[]>(
        'SELECT `PageId` FROM `Page` WHERE `BookId` = ? AND `Name` = ? AND `PageId` != ?',
        [bookId, page.name, page.id],
    );
    if (existingPages.length > 0) {
        throw new MyError('common', 'duplicate page name');
    }

    await pool.execute(
        'UPDATE `Page` SET `Name` = ?, `Content` = ?, `UpdateTime` = ? WHERE `PageId` = ?',
        [page.name, page.content ?? '', ax.now.format('YYYY-MM-DD HH:mm:ss'), page.id],
    );
    page.updateTime = formatDateTime(ax.now);
    return page;
}

async function movePage(ax: ActionContext, pageId: number, newSectionId: number): Promise<void> {
}

async function sharePage(ax: ActionContext, pageId: number): Promise<I.SharePageResult> {
    return null;
}

async function unsharePage(ax: ActionContext, pageId: number): Promise<void> {
}

async function removePage(ax: ActionContext, pageId: number): Promise<void> {
}

async function getPageHistories(ax: ActionContext, pageId: number): Promise<I.PageHistory[]> {
    return null;
}

async function getPageHistory(ax: ActionContext, historyId: number): Promise<I.PageHistory> {
    return null;
}

async function savePageVersion(ax: ActionContext, pageId: number, body: I.PageHistory): Promise<I.PageHistory> {
    return null;
}

async function restorePageVersion(ax: ActionContext, pageId: number, historyId: number): Promise<I.Page> {
    return null;
}

async function removePageVersion(ax: ActionContext, historyId: number): Promise<void> {
}

async function getPageFiles(ax: ActionContext, pageId: number): Promise<I.EmbeddedFile[]> {
    return null;
}

async function getPageFile(ax: ActionContext, fileId: number): Promise<I.EmbeddedFile> {
    return null;
}

async function addPageFile(ax: ActionContext, pageId: number, body: I.EmbeddedFile): Promise<I.EmbeddedFile> {
    return null;
}

async function updatePageFile(ax: ActionContext, body: I.EmbeddedFile): Promise<I.EmbeddedFile> {
    return null;
}

async function removePageFile(ax: ActionContext, fileId: number): Promise<void> {
}

async function search(ax: ActionContext, body: I.Query): Promise<I.QueryResult> {
    return null;
}

// AUTOGEN 338a3ed783d232aa2083fcd9dc160ca85b8c859193309165170e6ba1ff5a4c2c
// --------------------------------------
// ------ ATTENTION AUTO GENERATED ------
// --------------------------------------
/* eslint-disable @stylistic/lines-between-class-members */

class MyError extends Error {
    // fine error middleware need this to know this is known error type
    public readonly name: string = 'FineError';
    public constructor(public readonly kind: MyErrorKind, message?: string) { super(message); }
}
class ParameterValidator {
    public constructor(private readonly parameters: URLSearchParams) {}
    private validate<T>(name: string, optional: boolean, convert: (raw: string) => T, validate: (value: T) => boolean): T {
        if (!this.parameters.has(name)) {
            if (optional) { return null; } else { throw new MyError('common', `missing required parameter ${name}`); }
        }
        const raw = this.parameters.get(name);
        const result = convert(raw);
        if (validate(result)) { return result; } else { throw new MyError('common', `invalid parameter ${name} value ${raw}`); }
    }
    public id(name: string) { return this.validate(name, false, parseInt, v => !isNaN(v) && v > 0); }
    public idopt(name: string) { return this.validate(name, true, parseInt, v => !isNaN(v) && v > 0); }
    public string(name: string) { return this.validate(name, false, v => v, v => !!v); }
}
export async function dispatch(ctx: DispatchContext): Promise<DispatchResult> {
    const { pathname, searchParams } = new URL(ctx.path, 'https://example.com');
    const v = new ParameterValidator(searchParams);
    const ax: ActionContext = { now: ctx.state.now, userId: ctx.state.user?.id, userName: ctx.state.user?.name };
    const action = ({
        'GET /v1/books': () => getBooks(ax),
        'GET /v1/book': () => getBook(ax, v.id('bookId')),
        'PUT /v1/add-book': () => addBook(ax, ctx.body),
        'POST /v1/update-book': () => updateBook(ax, ctx.body),
        'DELETE /v1/remove-book': () => removeBook(ax, v.id('bookId')),
        'PUT /v1/add-section': () => addSection(ax, v.id('bookId'), v.idopt('sectionId')),
        'POST /v1/update-section': () => updateSection(ax, v.id('bookId'), ctx.body),
        'POST /v1/move-section': () => moveSection(ax, v.id('bookId'), v.id('sectionId'), v.idopt('newParentId')),
        'DELETE /v1/remove-section': () => removeSection(ax, v.id('bookId'), v.id('sectionId')),
        'GET /v1/page': () => getPage(ax, v.id('pageId')),
        'GET /public/v1/page': () => publicGetPage(ax, v.string('shareId')),
        'PUT /v1/add-page': () => addPage(ax, v.id('bookId'), v.idopt('sectionId'), ctx.body),
        'POST /v1/update-page': () => updatePage(ax, ctx.body),
        'POST /v1/move-page': () => movePage(ax, v.id('pageId'), v.idopt('newSectionId')),
        'POST /v1/share-page': () => sharePage(ax, v.id('pageId')),
        'POST /v1/unshare-page': () => unsharePage(ax, v.id('pageId')),
        'DELETE /v1/remove-page': () => removePage(ax, v.id('pageId')),
        'GET /v1/page-histories': () => getPageHistories(ax, v.id('pageId')),
        'GET /v1/page-history': () => getPageHistory(ax, v.id('historyId')),
        'POST /v1/save-page-version': () => savePageVersion(ax, v.id('pageId'), ctx.body),
        'POST /v1/restore-page-version': () => restorePageVersion(ax, v.id('pageId'), v.id('historyId')),
        'DELETE /v1/remove-page-version': () => removePageVersion(ax, v.id('historyId')),
        'GET /v1/page-files': () => getPageFiles(ax, v.id('pageId')),
        'GET /v1/page-file': () => getPageFile(ax, v.id('fileId')),
        'PUT /v1/add-page-file': () => addPageFile(ax, v.id('pageId'), ctx.body),
        'POST /v1/update-page-file': () => updatePageFile(ax, ctx.body),
        'DELETE /v1/remove-page-file': () => removePageFile(ax, v.id('fileId')),
        'POST /v1/search': () => search(ax, ctx.body),
    } as Record<string, () => Promise<any>>)[`${ctx.method} ${pathname}`];
    return action ? { body: await action() } : { error: new MyError('not-found', 'invalid-invocation') };
}
