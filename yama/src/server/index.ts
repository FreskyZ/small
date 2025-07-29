import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import mysql from 'mysql2/promise';
import * as I from '../shared/api.js';
import * as D from './database.js';
import type { MyErrorKind, ActionContext, DispatchContext, DispatchResult } from './dispatch.js';

dayjs.extend(utc);

async function getBooks(ax: ActionContext): Promise<any> {
}

async function getBook(ax: ActionContext, bookId: number): Promise<any> {
}

async function addBook(ax: ActionContext, body: any): Promise<any> {
}

async function updateBook(ax: ActionContext, body: any): Promise<any> {
}

async function removeBook(ax: ActionContext, bookId: number): Promise<any> {
}

async function getSections(ax: ActionContext, bookId: number): Promise<any> {
}

async function getSection(ax: ActionContext, sectionId: number): Promise<any> {
}

async function addSection(ax: ActionContext, bookId: number, body: any): Promise<any> {
}

async function updateSection(ax: ActionContext, body: any): Promise<any> {
}

async function removeSection(ax: ActionContext, sectionId: number): Promise<any> {
}

async function moveSectionToParent(ax: ActionContext, sectionId: number, newParentSectionId: number): Promise<any> {
}

async function getPages(ax: ActionContext, bookId: number, sectionId: number): Promise<any> {
}

async function getPage(ax: ActionContext, pageId: number): Promise<any> {
}

async function addPage(ax: ActionContext, bookId: number, sectionId: number, body: any): Promise<any> {
}

async function updatePage(ax: ActionContext, body: any): Promise<any> {
}

async function removePage(ax: ActionContext, pageId: number): Promise<any> {
}

async function movePageToSection(ax: ActionContext, pageId: number, newSectionId: number): Promise<any> {
}

async function sharePage(ax: ActionContext, pageId: number): Promise<any> {
}

async function unsharePage(ax: ActionContext, pageId: number): Promise<any> {
}

async function publicGetPage(ax: ActionContext, shareId: string): Promise<any> {
}

async function getPageHistory(ax: ActionContext, pageId: number): Promise<any> {
}

async function getPageHistoryVersion(ax: ActionContext, historyId: number): Promise<any> {
}

async function savePageVersion(ax: ActionContext, pageId: number, body: any): Promise<any> {
}

async function restorePageVersion(ax: ActionContext, pageId: number, historyId: number): Promise<any> {
}

async function removePageVersion(ax: ActionContext, historyId: number): Promise<any> {
}

async function getPageFiles(ax: ActionContext, pageId: number): Promise<any> {
}

async function getPageFile(ax: ActionContext, fileId: number): Promise<any> {
}

async function addPageFile(ax: ActionContext, pageId: number, body: any): Promise<any> {
}

async function updatePageFile(ax: ActionContext, body: any): Promise<any> {
}

async function removePageFile(ax: ActionContext, fileId: number): Promise<any> {
}

async function searchPages(ax: ActionContext, query: number, bookId: number): Promise<any> {
}

async function searchInBook(ax: ActionContext, bookId: number, query: number): Promise<any> {
}

// AUTOGEN ec1461fa87b889b0ebc81a6b79582812bda0b827c3f876d324c6d6f3826c412b
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
        'GET /v1/sections': () => getSections(ax, v.id('bookId')),
        'GET /v1/section': () => getSection(ax, v.id('sectionId')),
        'PUT /v1/add-section': () => addSection(ax, v.id('bookId'), ctx.body),
        'POST /v1/update-section': () => updateSection(ax, ctx.body),
        'DELETE /v1/remove-section': () => removeSection(ax, v.id('sectionId')),
        'POST /v1/move-section-to-parent': () => moveSectionToParent(ax, v.id('sectionId'), v.id('newParentSectionId?')),
        'GET /v1/pages': () => getPages(ax, v.id('bookId'), v.id('sectionId')),
        'GET /v1/page': () => getPage(ax, v.id('pageId')),
        'PUT /v1/add-page': () => addPage(ax, v.id('bookId'), v.id('sectionId'), ctx.body),
        'POST /v1/update-page': () => updatePage(ax, ctx.body),
        'DELETE /v1/remove-page': () => removePage(ax, v.id('pageId')),
        'POST /v1/move-page-to-section': () => movePageToSection(ax, v.id('pageId'), v.id('newSectionId')),
        'POST /v1/share-page': () => sharePage(ax, v.id('pageId')),
        'POST /v1/unshare-page': () => unsharePage(ax, v.id('pageId')),
        'GET /public/v1/page': () => publicGetPage(ax, v.string('shareId')),
        'GET /v1/page-history': () => getPageHistory(ax, v.id('pageId')),
        'GET /v1/page-history-version': () => getPageHistoryVersion(ax, v.id('historyId')),
        'POST /v1/save-page-version': () => savePageVersion(ax, v.id('pageId'), ctx.body),
        'POST /v1/restore-page-version': () => restorePageVersion(ax, v.id('pageId'), v.id('historyId')),
        'DELETE /v1/remove-page-version': () => removePageVersion(ax, v.id('historyId')),
        'GET /v1/page-files': () => getPageFiles(ax, v.id('pageId')),
        'GET /v1/page-file': () => getPageFile(ax, v.id('fileId')),
        'PUT /v1/add-page-file': () => addPageFile(ax, v.id('pageId'), ctx.body),
        'POST /v1/update-page-file': () => updatePageFile(ax, ctx.body),
        'DELETE /v1/remove-page-file': () => removePageFile(ax, v.id('fileId')),
        'POST /v1/search-pages': () => searchPages(ax, v.id('query'), v.id('bookId?')),
        'POST /v1/search-in-book': () => searchInBook(ax, v.id('bookId'), v.id('query')),
    } as Record<string, () => Promise<any>>)[`${ctx.method} ${pathname}`];
    return action ? { body: await action() } : { error: new MyError('not-found', 'invalid-invocation') };
}
