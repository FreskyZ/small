// --------------------------------------
// ------ ATTENTION AUTO GENERATED ------
// --------------------------------------

import type { startup } from './startup.js';
import type * as I from '../shared/api-types.js';

export const makeapi = (sendRequest: Parameters<Parameters<typeof startup>[5]>[0]) => ({
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
});
