// Browser-side helper for this app's own API routes. Authentication is the
// Supabase session cookie; no secrets are ever handled in the browser.
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(url: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError("Network error — check your connection and retry.", 0, "network");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as { error?: { message?: string; code?: string } } | null)?.error;
    if (res.status === 401) throw new ApiError("Your session expired. Sign in again.", 401, "unauthorized");
    throw new ApiError(err?.message ?? `Request failed (${res.status})`, res.status, err?.code ?? "error");
  }
  return data as T;
}
