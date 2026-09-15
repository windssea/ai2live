/**
 * Optional live API smoke test.
 * Skipped unless AI2LIVE_LIVE_API_TEST=1 and a real key is configured.
 * Never run in default CI.
 */
import { describe, it, expect } from "vitest";
import { createProvider, resolveProviderId, isDryRun } from "./index.js";

const enabled = process.env.AI2LIVE_LIVE_API_TEST === "1";

describe.skipIf(!enabled)("live API integration (AI2LIVE_LIVE_API_TEST=1)", () => {
  it("chat completes against configured provider", async () => {
    if (isDryRun()) {
      // Still exercise the path, but dry-run is fine
    }
    const id = resolveProviderId();
    const provider = createProvider(id);
    const result = await provider.chat({
      messages: [
        { role: "system", content: "Reply with the single word: pong" },
        { role: "user", content: "ping" },
      ],
      temperature: 0,
    });
    expect(result.provider).toBe(id);
    expect(typeof result.text).toBe("string");
    expect(result.text.length).toBeGreaterThan(0);
  }, 120_000);
});
