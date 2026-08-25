/** Minimal fetch wrapper: JSON, timeout, one retry, honest User-Agent. */
const UA = "jobradar/0.1 (open-source job aggregator; +https://github.com/sivareddy123-c/sivareddy)";

export async function getJson<T>(url: string, timeoutMs = 20000): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { accept: "application/json", "user-agent": UA },
      });
      if (res.status === 404) throw new NotFoundError(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (err instanceof NotFoundError) throw err;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

export class NotFoundError extends Error {
  constructor(url: string) {
    super(`404 Not Found: ${url} (board token probably wrong or board unpublished)`);
    this.name = "NotFoundError";
  }
}
