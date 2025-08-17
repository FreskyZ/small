
// access control shared types, used in src/core/access.ts and user page

export interface UserSession {
    id?: number,
    // app user session use app, does not have name,
    // not used in identity provider user session
    app?: string,
    name?: string,
    lastAccessTime: string,
    lastAccessAddress?: string,
}

export interface UserCredential {
    id: number,
    name: string,
    // app.example.com does not get session id and session name
    sessionId?: number,
    sessionName?: string,
}
