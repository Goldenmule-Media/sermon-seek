import { Button } from "@/components/ui/button"
import { adminBaseUrl } from "@/lib/env"

export default function LoginPage() {
  const returnTo = encodeURIComponent(`${adminBaseUrl()}/`)
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"
  const signInUrl = `${apiUrl}/v1/auth/google/start?return_to=${returnTo}`

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Sermon-Search Admin</h1>
      <p className="text-muted-foreground text-sm">
        Sign in with the Google account on your admin allowlist.
      </p>
      <Button asChild>
        <a href={signInUrl}>Sign in with Google</a>
      </Button>
    </main>
  )
}
