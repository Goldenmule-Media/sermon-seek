export function adminApiUrl(): string {
  const url = process.env.ADMIN_API_URL
  if (!url) {
    throw new Error("ADMIN_API_URL is required")
  }
  return url
}

export function adminBaseUrl(): string {
  const url = process.env.ADMIN_BASE_URL
  if (!url) {
    throw new Error("ADMIN_BASE_URL is required")
  }
  return url
}
