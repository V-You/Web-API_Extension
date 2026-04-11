import { describe, expect, it, vi } from "vitest";

import { RateLimiter } from "./rate-limiter";

describe("rate-limiter", () => {
  it("allows immediate acquisition when tokens are available", async () => {
    const limiter = new RateLimiter(9);
    const start = Date.now();
    await limiter.acquire();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("exhausts tokens and waits for refill", async () => {
    const limiter = new RateLimiter(2); // 2 req/s for fast testing
    await limiter.acquire();
    await limiter.acquire();

    // Third acquire should wait ~500ms (1 token / 2 per second)
    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(200); // some tolerance
  });

  it("allows bursting up to the max token count", async () => {
    const limiter = new RateLimiter(5);
    const start = Date.now();
    for (let i = 0; i < 5; i++) {
      await limiter.acquire();
    }
    expect(Date.now() - start).toBeLessThan(100); // all immediate
  });

  it("refills tokens over time", async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter(10);

    // Drain all tokens
    for (let i = 0; i < 10; i++) {
      await limiter.acquire();
    }

    // Advance by 500ms -- should refill 5 tokens
    vi.advanceTimersByTime(500);

    // Should be able to acquire without waiting
    const promise = limiter.acquire();
    vi.advanceTimersByTime(0);
    await promise;

    vi.useRealTimers();
  });
});
