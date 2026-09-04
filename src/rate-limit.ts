import type { NextFunction, Request, Response } from "express";

export interface RateLimitOptions {
  /** Sliding window in milliseconds. */
  windowMs: number;
  /** Max requests per key per window. */
  max: number;
  /** JSON error message returned with 429. */
  message?: string;
  /** Skip the limiter entirely (e.g. in tests for unrelated suites). */
  skip?: (req: Request) => boolean;
}

export interface RateLimiter {
  middleware: (req: Request, res: Response, next: NextFunction) => void;
  /** Clear all tracked keys (used by tests). */
  reset: () => void;
  /** Stop the background sweep timer. */
  stop: () => void;
}

/**
 * Tiny in-memory sliding-window rate limiter (no dependencies).
 * Suitable for a single-instance sync backend; front with Azure Front Door /
 * API Management limits if you scale horizontally.
 */
export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const { windowMs, max, message = "Too many requests, please try again later." } = options;
  const hits = new Map<string, number[]>();

  const sweep = () => {
    const cutoff = Date.now() - windowMs;
    for (const [key, stamps] of hits) {
      const fresh = stamps.filter((t) => t > cutoff);
      if (fresh.length === 0) hits.delete(key);
      else hits.set(key, fresh);
    }
  };
  // Unref so the timer never keeps the process alive on its own.
  const timer = setInterval(sweep, Math.min(windowMs, 60_000));
  if (typeof timer === "object" && "unref" in timer && typeof timer.unref === "function") {
    timer.unref();
  }

  return {
    middleware(req: Request, res: Response, next: NextFunction) {
      if (options.skip?.(req)) {
        next();
        return;
      }
      const key = (req.ip ?? req.socket.remoteAddress ?? "unknown") + ":" + (req.path ?? req.url);
      const now = Date.now();
      const cutoff = now - windowMs;
      const stamps = (hits.get(key) ?? []).filter((t) => t > cutoff);
      if (stamps.length >= max) {
        const retryAfter = Math.ceil((stamps[0] + windowMs - now) / 1000);
        res.setHeader("Retry-After", String(Math.max(retryAfter, 1)));
        res.status(429).json({ error: message });
        return;
      }
      stamps.push(now);
      hits.set(key, stamps);
      next();
    },
    reset() {
      hits.clear();
    },
    stop() {
      clearInterval(timer);
    },
  };
}
