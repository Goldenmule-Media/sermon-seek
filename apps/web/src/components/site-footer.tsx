import { Heart } from "lucide-react"
import Image from "next/image"
import Link from "next/link"

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t bg-background/60">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:px-6 lg:px-8">
        <nav className="flex items-center gap-4">
          <Link href="/about" className="hover:text-foreground transition-colors">
            About
          </Link>
          <Link href="/privacy" className="hover:text-foreground transition-colors">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-foreground transition-colors">
            Terms
          </Link>
        </nav>
        <div className="flex items-center gap-1.5">
          <span>Made with</span>
          <Heart className="h-4 w-4 fill-red-500 text-red-500" aria-hidden />
          <span>by</span>
          <a
            href="https://goldenmulemedia.com"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            <Image
              src="https://thegoldenmule.com/logo.png"
              alt="Goldenmule Media"
              width={16}
              height={16}
              className="h-4 w-4"
              unoptimized
            />
            <span>Goldenmule Media</span>
          </a>
        </div>
      </div>
    </footer>
  )
}
