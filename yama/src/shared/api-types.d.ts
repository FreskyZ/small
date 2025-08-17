// --------------------------------------
// ------ ATTENTION AUTO GENERATED ------
// --------------------------------------

export interface Book {
    id: number,
    name: string,
    createTime?: string,
    updateTime?: string,
    sections: Section[],
    pages: Page[],
}
export interface Section {
    id: number,
    parentId?: number,
    name: string,
    createTime?: string,
    updateTime?: string,
    sections: Section[],
    pages: Page[],
}
export interface Page {
    id: number,
    name: string,
    content: string,
    createTime?: string,
    updateTime?: string,
    shareId?: string,
    files: EmbeddedFile[],
}
export interface PageHistory {
    id: number,
    name: string,
    createTime?: string,
    operations: PageOperation[],
}
export interface PageOperation {
    historyId: number,
    kind: string,
    line: number,
    content: string,
}
export interface EmbeddedFile {
    id: number,
    name: string,
    content: string,
    createTime?: string,
}
export interface SharePageResult {
    id: string,
}
export interface Query {
    includeBookName: boolean,
    includeSectionName: boolean,
    includePageName: boolean,
    includePageContent: boolean,
    bookId?: number,
    regex: boolean,
    content: string,
}
export interface QueryResult {
    Books: Book[],
    SectionNames: Section[],
    PageNames: Page[],
}
