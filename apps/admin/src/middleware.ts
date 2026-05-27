import { type NextRequest, NextResponse } from "next/server"

const ADMIN_API_URL = process.env.ADMIN_API_URL ?? "http://localhost:3001"

export async function middleware(request: NextRequest) {
  let me: { is_admin: boolean } | null = null

  try {
    const res = await fetch(`${ADMIN_API_URL}/v1/me`, {
      headers: { cookie: request.headers.get("cookie") ?? "" },
    })

    if (res.status === 401) {
      return NextResponse.redirect(new URL("/login", request.url))
    }

    if (res.ok) {
      me = (await res.json()) as { is_admin: boolean }
    } else {
      return NextResponse.redirect(new URL("/login", request.url))
    }
  } catch {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  if (!me?.is_admin) {
    return NextResponse.redirect(new URL("/not-authorized", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!login|not-authorized|_next/static|_next/image|favicon\\.ico).*)"],
}
