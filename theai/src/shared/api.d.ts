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
