export const TENANT_SCOPED_ROUTES = [
  { method: "GET", path: "/home" },
  { method: "GET", path: "/search" },
  { method: "GET", path: "/playlists" },
  { method: "GET", path: "/playlists/:slug/videos" },
  { method: "GET", path: "/topics" },
  { method: "GET", path: "/topics/:slug" },
  { method: "GET", path: "/videos/:id" },
  { method: "GET", path: "/videos/:id/transcript" },
  { method: "GET", path: "/videos/:id/related" },
  { method: "GET", path: "/videos/:id/search" },
] as const satisfies ReadonlyArray<{ method: string; path: string }>
