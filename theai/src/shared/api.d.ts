// --------------------------------------
// ------ ATTENTION AUTO GENERATED ------
// --------------------------------------

export interface Session {
    id: number,
    name: string,
    comment?: string,
    createTime: string,
    tags: string[],
    messages: Message[],
}
export interface Message {
    id: number,
    parentId?: number,
    role: string,
    content: string,
    promptTokenCount?: number,
    completionTokenCount?: number,
}
export interface SharedSession {
    id: string,
}
export interface AccountBalance {
    balance: number,
}
