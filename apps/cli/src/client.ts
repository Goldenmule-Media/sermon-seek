import type { ResolvedInstance } from "./instance.js"

export interface HealthWorker {
  worker_id: string
  kind: string
  last_beat_at: string
  status: string
  last_job_id: string | null
  message: string | null
  stale: boolean
}

export interface SystemRun {
  last_run_at: string | null
  last_status: string | null
}

export interface HealthResponse {
  workers: HealthWorker[]
  view_stats: SystemRun
  smoke_test: SystemRun
}

export interface AdminClient {
  health(): Promise<HealthResponse>
}

export function createClient(instance: ResolvedInstance): AdminClient {
  const { name, baseUrl, adminKey } = instance
  const base = `${baseUrl.replace(/\/$/, "")}/v1`

  async function request<T>(path: string): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${base}${path}`, {
        headers: { "x-admin-key": adminKey },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Can't reach ${baseUrl}: ${msg}`)
    }
    if (res.status === 401) {
      throw new Error(`Admin key rejected for instance "${name}". Check your stored key.`)
    }
    if (res.status === 403) {
      throw new Error(`Forbidden (403) from instance "${name}".`)
    }
    if (!res.ok) {
      let detail = ""
      try {
        const body = (await res.json()) as { error?: string }
        detail = body.error ? `: ${body.error}` : ""
      } catch {
        // ignore parse error
      }
      throw new Error(`HTTP ${res.status} from ${baseUrl}${detail}`)
    }
    return res.json() as Promise<T>
  }

  return {
    health(): Promise<HealthResponse> {
      return request<HealthResponse>("/admin/health")
    },
  }
}
