/**
 * Minimal Canvas REST client: bearer auth, Link-header pagination, and
 * typed errors. Every other file in lib/canvas builds on these two calls.
 */

export class CanvasError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "CanvasError";
  }
}

function config() {
  const base = process.env.CANVAS_BASE_URL?.replace(/\/+$/, "");
  const token = process.env.CANVAS_TOKEN;
  if (!base || !token) {
    throw new CanvasError(
      "CANVAS_BASE_URL and CANVAS_TOKEN must be set in .env.local",
      0,
    );
  }
  return { base, token };
}

export type Params = Record<
  string,
  string | number | boolean | Array<string | number> | undefined
>;

function buildUrl(base: string, path: string, params?: Params) {
  const url = new URL(path.startsWith("http") ? path : `${base}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      // Canvas array params are `key[]=a&key[]=b`
      const k = key.endsWith("[]") ? key : `${key}[]`;
      for (const v of value) url.searchParams.append(k, String(v));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function parseNext(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

async function request(url: URL, init: RequestInit, attempt = 0): Promise<Response> {
  const { token } = config();
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  // Canvas signals throttling with 403 + "Rate Limit Exceeded", not 429.
  if (
    (res.status === 403 && (await res.clone().text()).includes("Rate Limit")) ||
    res.status === 429
  ) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      return request(url, init, attempt + 1);
    }
  }
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => undefined);
    }
    throw new CanvasError(
      `Canvas ${init.method ?? "GET"} ${url.pathname} failed: ${res.status}`,
      res.status,
      body,
    );
  }
  return res;
}

/** GET a single resource (no pagination). */
export async function canvasGet<T>(path: string, params?: Params): Promise<T> {
  const { base } = config();
  const res = await request(buildUrl(base, path, params), { method: "GET" });
  return (await res.json()) as T;
}

/** GET a list, following `Link: rel="next"` until exhausted. */
export async function canvasGetAll<T>(path: string, params?: Params): Promise<T[]> {
  const { base } = config();
  const out: T[] = [];
  let url: URL | null = buildUrl(base, path, { per_page: 100, ...params });
  while (url) {
    const res = await request(url, { method: "GET" });
    out.push(...((await res.json()) as T[]));
    const next = parseNext(res.headers.get("link"));
    url = next ? new URL(next) : null;
  }
  return out;
}

export async function canvasPost<T>(path: string, body: unknown): Promise<T> {
  const { base } = config();
  const res = await request(buildUrl(base, path), {
    method: "POST",
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export async function canvasPut<T>(path: string, body: unknown): Promise<T> {
  const { base } = config();
  const res = await request(buildUrl(base, path), {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export function canvasConfigured() {
  return Boolean(process.env.CANVAS_BASE_URL && process.env.CANVAS_TOKEN);
}
