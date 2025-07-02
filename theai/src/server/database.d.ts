// --------------------------------------
// ------ ATTENTION AUTO GENERATED ------
// --------------------------------------

export interface Session {
    SessionId: number,
    UserId: number,
    Name: string,
    Comment?: string,
    Tags: string,
    CreateTime: string,
}
export interface Message {
    MessageId: number,
    SessionId: number,
    ParentMessageId?: number,
    Role: string,
    Content: string,
    PromptTokenCount?: number,
    CompletionTokenCount?: number,
    CreateTime: string,
}
export interface SharedSession {
    ShareId: string,
    SessionId: number,
    ExpireTime: string,
    CreateTime: string,
}
