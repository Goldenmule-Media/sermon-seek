import { SiteFooter } from "@/components/site-footer"
import { SiteHeader } from "@/components/site-header"
import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "SermonSeek.ai",
  description: "Search thousands of sermons by topic, scripture, or keyword.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased flex flex-col">
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  )
}
