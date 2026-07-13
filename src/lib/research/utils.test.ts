import { describe, expect, it } from "vitest";

import { UnsafeResearchUrlError } from "./errors";
import { expandVerifiedOfficialDomains } from "./identity";
import {
  canonicalizeResearchUrl,
  inferSourceClass,
  validatePublicResearchUrl,
} from "./utils";

describe("research URL safety", () => {
  it.each([
    "http://localhost:3000/private",
    "http://127.0.0.1/private",
    "http://10.1.2.3/private",
    "http://192.168.1.4/private",
    "http://169.254.169.254/latest/meta-data",
    "file:///etc/passwd",
    "https://user:password@example.com/",
  ])("rejects unsafe URL %s", (url) => {
    expect(() => validatePublicResearchUrl(url)).toThrow(
      UnsafeResearchUrlError,
    );
  });

  it("removes trackers and fragments from canonical URLs", () => {
    expect(
      canonicalizeResearchUrl(
        "https://Example.com/a/?utm_source=x&gclid=y#section",
      ),
    ).toBe("https://example.com/a");
  });
});

describe("source classification", () => {
  it("recognizes official candidate and filing domains", () => {
    expect(
      inferSourceClass("https://investors.vertiv.com/report", [
        "vertiv.com",
      ]),
    ).toBe("official_company");
    expect(
      inferSourceClass("https://www.sec.gov/Archives/test", []),
    ).toBe("official_filing");
  });

  it("expands evidence-backed official corporate domain aliases", () => {
    const domains = expandVerifiedOfficialDomains([
      "download.schneider-electric.com",
    ]);
    expect(domains).toEqual(
      expect.arrayContaining(["download.schneider-electric.com", "se.com"]),
    );
    expect(
      inferSourceClass("https://www.se.com/ww/en/about-us", domains),
    ).toBe("official_company");
  });
});
