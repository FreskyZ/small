
export interface LookupSession {
    id: number,
    name: string,
    comment: string,
    createTime: string,
}
export interface SessionDirectory {
    id: number, // 0 for the virtual root directory
    name: string,
    directories: SessionDirectory[],
    sessions: LookupSession[],
}
export interface Session {
    id: number,
    name: string,
    comment: string,
    versions: SessionVersion[],
}
export interface SessionVersion {
    version: number,
    comment: string,
    createTime: string,
    promptTokenCount: number,
    completionTokenCount: number,
    messages: Message[],
}
export interface Message {
    role: string,
    content: string,
}
export interface ShareResult {
    id: string, // SharedSession.Id guid
}
