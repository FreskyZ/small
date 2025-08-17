// --------------------------------------
// ------ ATTENTION AUTO GENERATED ------
// --------------------------------------

import type { Dayjs } from 'dayjs';

export interface Session {
    SessionId: number,
    UserId: number,
    Name: string,
    Comment?: string,
    Tags: string,
    Shared: boolean,
    ShareId?: string,
    CreateTime: Dayjs,
    UpdateTime: Dayjs,
}
export interface Message {
    SessionId: number,
    MessageId: number,
    ParentMessageId?: number,
    Role: string,
    Content: string,
    ThinkingContent?: string,
    PromptTokenCount?: number,
    CompletionTokenCount?: number,
    CreateTime: Dayjs,
    UpdateTime: Dayjs,
}
export interface UserModel {
    UserId: number,
    Name: string,
    APIKey: string,
    CreateTime: Dayjs,
    UpdateTime: Dayjs,
}
