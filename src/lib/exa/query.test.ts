import { describe, expect, it } from "vitest";

import {
  broadenTier3Query,
  buildTier3Query,
  collapseWhitespace,
  isStopword,
  stripInstructionalPreamble,
} from "./query";

describe("buildTier3Query", () => {
  it("concatenates candidate name with stripped prompt hint", () => {
    const q = buildTier3Query(
      "Find the latest product announcement in rack PDU.",
      "Schneider Electric",
    );
    expect(q).toBe("Schneider Electric latest product announcement in rack PDU");
  });

  it("strips trailing punctuation", () => {
    expect(buildTier3Query("Identify the buyer title.", "Eaton")).toBe(
      "Eaton buyer title",
    );
  });

  it("collapses runs of whitespace", () => {
    expect(buildTier3Query("Find    the     latest news", "Vertiv")).toBe(
      "Vertiv latest news",
    );
  });

  it("handles a prompt hint with no instructional preamble", () => {
    expect(buildTier3Query("data center strategy signals", "Schneider")).toBe(
      "Schneider data center strategy signals",
    );
  });

  it("stays deterministic — same inputs produce same output", () => {
    const a = buildTier3Query("Find the recent acquisitions", "Schneider");
    const b = buildTier3Query("Find the recent acquisitions", "Schneider");
    expect(a).toBe(b);
  });
});

describe("broadenTier3Query", () => {
  it("drops the trailing meaningful token", () => {
    expect(
      broadenTier3Query("Schneider Electric latest product announcement rack PDU"),
    ).toBe("Schneider Electric latest product announcement rack");
  });

  it("drops trailing stopwords before dropping a meaningful token", () => {
    // "...announcements in rack" → drop "in" (stopword) → drop "rack" (token) → settle
    expect(
      broadenTier3Query("Schneider latest announcements in rack"),
    ).toBe("Schneider latest announcements");
  });

  it("returns null when the input query has 3 or fewer tokens", () => {
    expect(broadenTier3Query("Schneider founded year")).toBeNull();
    expect(broadenTier3Query("Schneider founded")).toBeNull();
    expect(broadenTier3Query("Schneider")).toBeNull();
  });

  it("broadens a 4-token query down to 3 tokens", () => {
    expect(broadenTier3Query("Eaton recent product news")).toBe(
      "Eaton recent product",
    );
  });

  it("never returns the same string it was given", () => {
    const q = "Schneider Electric founded year";
    expect(broadenTier3Query(q)).not.toBe(q);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────────

describe("stripInstructionalPreamble", () => {
  it("strips 'Find the' prefix", () => {
    expect(stripInstructionalPreamble("Find the founded year.")).toBe(
      "founded year.",
    );
  });

  it("strips 'Identify' prefix", () => {
    expect(
      stripInstructionalPreamble("Identify whether the company is public."),
    ).toBe("whether the company is public.");
  });

  it("strips 'Classify' prefix", () => {
    expect(stripInstructionalPreamble("Classify the customer segment.")).toBe(
      "customer segment.",
    );
  });

  it("is idempotent — running twice yields same result", () => {
    const once = stripInstructionalPreamble("Find the headcount.");
    const twice = stripInstructionalPreamble(once);
    expect(twice).toBe(once);
  });

  it("leaves a hint without preamble unchanged", () => {
    expect(stripInstructionalPreamble("data center strategy")).toBe(
      "data center strategy",
    );
  });
});

describe("collapseWhitespace", () => {
  it("collapses tabs and multiple spaces", () => {
    expect(collapseWhitespace("a   b\t\tc\n\nd")).toBe("a b c d");
  });

  it("trims leading and trailing", () => {
    expect(collapseWhitespace("  x  ")).toBe("x");
  });
});

describe("isStopword", () => {
  it("recognises common stopwords case-insensitively", () => {
    expect(isStopword("the")).toBe(true);
    expect(isStopword("THE")).toBe(true);
    expect(isStopword("In")).toBe(true);
  });

  it("returns false for content words", () => {
    expect(isStopword("Schneider")).toBe(false);
    expect(isStopword("PDU")).toBe(false);
  });
});
