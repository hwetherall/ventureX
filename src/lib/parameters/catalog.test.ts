import { describe, expect, it } from "vitest";
import {
  FRAMEWORK_PARAMETERS,
  HARDCODED_PARAMETERS,
  UNIVERSAL_PARAMETERS,
} from "./catalog";
import { assertUniqueParameterIds } from "./validation";
import { DIMENSION_KEYS } from "@/types/venture-profile";

describe("parameter catalog", () => {
  it("contains the expected hardcoded tier counts", () => {
    expect(UNIVERSAL_PARAMETERS).toHaveLength(15);
    expect(FRAMEWORK_PARAMETERS).toHaveLength(21);
    expect(HARDCODED_PARAMETERS).toHaveLength(36);
  });

  it("has unique ids across hardcoded parameters", () => {
    expect(() => assertUniqueParameterIds([...HARDCODED_PARAMETERS])).not.toThrow();
  });

  it("keeps universal parameters in meta and framework parameters in the 7 dimensions", () => {
    const dimensionSet = new Set(DIMENSION_KEYS);

    for (const parameter of UNIVERSAL_PARAMETERS) {
      expect(parameter.tier).toBe("universal");
      expect(parameter.innovera_dimension).toBe("meta");
    }

    for (const parameter of FRAMEWORK_PARAMETERS) {
      expect(parameter.tier).toBe("framework");
      expect(dimensionSet.has(parameter.innovera_dimension)).toBe(true);
    }
  });
});
