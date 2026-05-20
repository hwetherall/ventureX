import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  exaSearch,
  exaSearchWithBroadenRetry,
} from "./search";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_API_KEY = process.env.EXA_API_KEY;

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

function mockExaFetch(
  responseBuilder: (req: CapturedRequest) => Response | Promise<Response>,
) {
  const captured: CapturedRequest[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const bodyRaw = init?.body;
    const body =
      typeof bodyRaw === "string"
        ? (JSON.parse(bodyRaw) as Record<string, unknown>)
        : {};
    const req: CapturedRequest = { url, body };
    captured.push(req);
    return responseBuilder(req);
  }) as typeof fetch;
  return captured;
}

function exaPayload(results: { url: string; title: string; text: string }[]) {
  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  process.env.EXA_API_KEY = "test_key";
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_API_KEY === undefined) {
    delete process.env.EXA_API_KEY;
  } else {
    process.env.EXA_API_KEY = ORIGINAL_API_KEY;
  }
  vi.restoreAllMocks();
});

describe("exaSearch — request body", () => {
  it("does NOT include includeText when not specified", async () => {
    const captured = mockExaFetch(() =>
      exaPayload([
        { url: "https://example.com/a", title: "A", text: "text a" },
      ]),
    );

    await exaSearch({ query: "rack PDU vendors" });

    expect(captured).toHaveLength(1);
    expect(captured[0]!.body).not.toHaveProperty("includeText");
  });

  it("includes includeText as a single-element array when specified (M15-F1 anchoring)", async () => {
    // Exa's API requires includeText to be an array of strings, NOT a bare
    // string. Discovered 2026-05-20 when Heraeus Medevio run failed every T3
    // cell with HTTP 400 ("expected array, received string"). The caller
    // passes a string for ergonomics; the wrapper wraps it.
    const captured = mockExaFetch(() =>
      exaPayload([
        {
          url: "https://www.se.com/products/rack-pdu",
          title: "APC NetShelter | Schneider Electric",
          text: "Schneider Electric NetShelter Advanced Rack PDUs…",
        },
      ]),
    );

    await exaSearch({
      query: "rack power shelf product",
      includeText: "Schneider Electric",
    });

    expect(captured[0]!.body).toMatchObject({
      query: "rack power shelf product",
      includeText: ["Schneider Electric"],
    });
  });

  it("passes empty-string includeText through as a no-op (treated as falsy)", async () => {
    const captured = mockExaFetch(() =>
      exaPayload([
        { url: "https://example.com/a", title: "A", text: "text a" },
      ]),
    );

    await exaSearch({ query: "anything", includeText: "" });

    // Empty string is falsy in the spread condition — no includeText key
    // emitted in the request body. Callers should not pass empty strings;
    // if they do, the behavior is documented here.
    expect(captured[0]!.body).not.toHaveProperty("includeText");
  });
});

describe("exaSearch — results parsing", () => {
  it("normalises missing title/text to empty strings", async () => {
    mockExaFetch(() =>
      new Response(
        JSON.stringify({
          results: [{ url: "https://example.com/a" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const res = await exaSearch({ query: "x" });
    expect(res.results[0]).toMatchObject({
      url: "https://example.com/a",
      title: "",
      text: "",
    });
  });

  it("returns empty results array when Exa returns []", async () => {
    mockExaFetch(() => exaPayload([]));
    const res = await exaSearch({ query: "x" });
    expect(res.results).toHaveLength(0);
  });

  it("throws ExaError on non-2xx", async () => {
    mockExaFetch(
      () =>
        new Response("rate limited", {
          status: 429,
          headers: { "Content-Type": "text/plain" },
        }),
    );

    await expect(exaSearch({ query: "x" })).rejects.toThrow(/429/);
  });
});

describe("exaSearchWithBroadenRetry", () => {
  it("returns the initial response when results are non-empty", async () => {
    const captured = mockExaFetch(() =>
      exaPayload([
        { url: "https://example.com/a", title: "A", text: "text a" },
      ]),
    );

    const out = await exaSearchWithBroadenRetry({
      query: "Schneider Electric latest product announcement rack PDU",
      includeText: "Schneider Electric",
    });

    expect(captured).toHaveLength(1);
    expect(out.isEmpty).toBe(false);
    expect(out.broadened).toBeNull();
    expect(out.broadenedQuery).toBeNull();
    expect(out.response).toBe(out.initial);
  });

  it("broadens once on empty initial results, threads includeText through", async () => {
    let callCount = 0;
    const captured = mockExaFetch(() => {
      callCount += 1;
      // First call: empty. Second call (broadened): one result.
      return callCount === 1
        ? exaPayload([])
        : exaPayload([
            {
              url: "https://www.se.com/products/rack-pdu",
              title: "Rack PDU",
              text: "Schneider Electric…",
            },
          ]);
    });

    const out = await exaSearchWithBroadenRetry({
      query: "Schneider Electric latest product announcement rack PDU",
      includeText: "Schneider Electric",
    });

    expect(callCount).toBe(2);
    expect(captured[0]!.body).toMatchObject({
      includeText: ["Schneider Electric"],
    });
    expect(captured[1]!.body).toMatchObject({
      includeText: ["Schneider Electric"],
    });
    expect(out.broadenedQuery).not.toBeNull();
    expect(out.broadened).not.toBeNull();
    expect(out.isEmpty).toBe(false);
    expect(out.response).toBe(out.broadened);
  });

  it("reports isEmpty=true when both initial and broadened return empty", async () => {
    mockExaFetch(() => exaPayload([]));

    const out = await exaSearchWithBroadenRetry({
      query: "Schneider Electric latest product announcement rack PDU",
    });

    expect(out.isEmpty).toBe(true);
    expect(out.response).toBeNull();
  });

  it("does not broaden when query is too short to broaden meaningfully", async () => {
    let callCount = 0;
    mockExaFetch(() => {
      callCount += 1;
      return exaPayload([]);
    });

    const out = await exaSearchWithBroadenRetry({
      query: "Schneider founded year",
    });

    // 3 tokens — broadenTier3Query returns null, no retry attempted.
    expect(callCount).toBe(1);
    expect(out.broadenedQuery).toBeNull();
    expect(out.isEmpty).toBe(true);
  });
});
