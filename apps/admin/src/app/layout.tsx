import { Nav } from "@/components/nav"
import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Sermon-Search Admin",
  description: "Admin panel for Sermon-Search.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <Nav />
        {children}
      </body>
    </html>
  )
}
