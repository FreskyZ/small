// --------------------------------------
// ------ ATTENTION AUTO GENERATED ------
// --------------------------------------

import type { Dayjs } from 'dayjs';

export interface Book {
    BookId: number,
    UserId: number,
    Name: string,
    CreateTime: Dayjs,
    UpdateTime: Dayjs,
}
export interface Section {
    SectionId: number,
    BookId: number,
    ParentSectionId?: number,
    Name: string,
    CreateTime: Dayjs,
    UpdateTime: Dayjs,
}
export interface Page {
    PageId: number,
    BookId: number,
    SectionId?: number,
    Name: string,
    Content: string,
    Shared: boolean,
    ShareId?: string,
    CreateTime: Dayjs,
    UpdateTime: Dayjs,
}
export interface PageHistory {
    PageHistoryId: number,
    PageId: number,
    Name: string,
    CreateTime: Dayjs,
    UpdateTime: Dayjs,
}
export interface PageOperation {
    PageOperationId: number,
    PageHistoryId: number,
    Kind: string,
    Line: number,
    Content: string,
    CreateTime: Dayjs,
    UpdateTime: Dayjs,
}
export interface EmbeddedFile {
    FileId: number,
    UserId: number,
    PageId: number,
    Name: string,
    Content: undefined,
    CreateTime: Dayjs,
    UpdateTime: Dayjs,
}
export interface Query {
    QueryId: number,
    UserId: number,
    BookId?: number,
    IncludeBookName: boolean,
    IncludeSectionName: boolean,
    IncludePageName: boolean,
    IncludePageContent: boolean,
    UseRegularExpression: boolean,
    Content: string,
    CreateTime: Dayjs,
    UpdateTime: Dayjs,
}
