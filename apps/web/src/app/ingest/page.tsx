import type { Metadata } from "next"
import { IngestPage } from "./ingest-page"

export const metadata: Metadata = {
  title: "Request a church — SermonSeek.ai",
  description: "Submit a self-service ingestion request to add your church's YouTube channel.",
}

export default function Page() {
  return <IngestPage />
}
