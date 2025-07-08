// --------------------------------------
// ------ ATTENTION AUTO GENERATED ------
// --------------------------------------

export interface Session {
    id: number,
    name: string,
    comment?: string,
    createTime?: string,
    tags: string[],
    shareId?: string,
    messages: Message[],
}
export interface Message {
    id: number,
    parentId?: number,
    role: string,
    content: string,
    promptTokenCount?: number,
    completionTokenCount?: number,
    createTime?: string,
}
export interface SharedSession {
    id: string,
}
export interface AccountBalance {
    balance: number,
}
export interface dsession {
    id: string,
    seq_id: number,
    title: string,
    inserted_at: string,
    updated_at: string,
}
export interface dmessage {
    message_id: number,
    parent_id?: number,
    role: string,
    content: string,
    thinking_content?: string,
    accumulated_token_usage: number,
    inserted_at: string,
}
