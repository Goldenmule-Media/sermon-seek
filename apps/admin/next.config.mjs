import { fileURLToPath } from "url"
import path from "path"

const __dirname = fileURLToPath(new URL(".", import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(__dirname, "../../"),
  reactStrictMode: true,
}

export default nextConfig
