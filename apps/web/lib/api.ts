/** Thin client for the Commerce OS API (proxied at /api). Sends the CSRF token on writes. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

function csrf(): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie.match(/(?:^|; )cos_csrf=([^;]+)/)?.[1];
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const method = (rest.method ?? (json !== undefined ? "POST" : "GET")).toUpperCase();
  const h = new Headers(headers);
  if (json !== undefined) h.set("content-type", "application/json");
  if (method !== "GET" && method !== "HEAD") {
    const t = csrf();
    if (t) h.set("x-csrf-token", decodeURIComponent(t));
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...rest,
      method,
      headers: h,
      credentials: "same-origin",
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError(0, "NETWORK", "The Commerce OS API is unreachable.");
  }
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON (proxy error page) */
  }
  if (!res.ok) {
    if (res.status >= 500 && !body) throw new ApiError(res.status, "API_DOWN", "The Commerce OS API is not responding.");
    throw new ApiError(res.status, body?.code ?? "ERROR", body?.message ?? res.statusText, body?.details);
  }
  return body as T;
}

/** Server-side fetch (RSC) straight to the API service. */
export async function serverApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = process.env.API_URL ?? "http://127.0.0.1:4100";
  const res = await fetch(`${base}${path}`, { ...init, cache: "no-store" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.code ?? "ERROR", body?.message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}
