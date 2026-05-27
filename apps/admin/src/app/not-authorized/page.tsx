import { SignOutButton } from "./sign-out-button"

export default function NotAuthorizedPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Not authorized</h1>
      <p className="text-muted-foreground text-sm max-w-sm">
        Your account isn&apos;t on the admin allowlist. Contact an existing admin if this is
        unexpected.
      </p>
      <SignOutButton />
    </main>
  )
}
