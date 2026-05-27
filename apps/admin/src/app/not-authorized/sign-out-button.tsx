"use client"

import { Button } from "@/components/ui/button"
import { postLogout } from "@/lib/auth"
import { useRouter } from "next/navigation"

export function SignOutButton() {
  const router = useRouter()

  async function handleSignOut() {
    await postLogout()
    router.replace("/login")
  }

  return (
    <Button variant="outline" onClick={handleSignOut}>
      Sign out
    </Button>
  )
}
