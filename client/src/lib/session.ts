/** One id per app launch; the server keys activity beats on it. */
export const sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36)
