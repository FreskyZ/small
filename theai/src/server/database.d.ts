// --------------------------------------
// ------ ATTENTION AUTO GENERATED ------
// --------------------------------------

export interface Session {
    SessionId: number,
    UserId: number,
    Name: string,
    Comment?: string,
    Tags: string,
    Shared: boolean,
    ShareId?: string,
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
