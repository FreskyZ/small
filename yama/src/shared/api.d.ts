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
    bookId: number,
    parentSectionId?: number,
    name: string,
    createTime?: string,
    updateTime?: string,
    sections: Section[],
    pages: Page[],
}
export interface Page {
    id: number,
    bookId: number,
    sectionId?: number,
    name: string,
    content: string,
    createTime?: string,
    updateTime?: string,
    shareId?: string,
    files: EmbeddedFile[],
    history: PageHistory[],
}
export interface PageHistory {
    id: number,
    pageId: number,
    name: string,
    createTime?: string,
    operations: PageOperation[],
}
export interface PageOperation {
    historyId: number,
    kind: string,
    originalLine: number,
    newLine: number,
    content: string,
}
export interface EmbeddedFile {
    id: number,
    pageId: number,
    name: string,
    content: string,
    createTime?: string,
}
export interface SharePageResult {
    id: string,
}
