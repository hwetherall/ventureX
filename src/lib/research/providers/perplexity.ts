import { ResearchProviderError } from "../errors";
import type {
  DeepResearchProvider,
  DeepResearchRequest,
  DeepResearchResponse,
} from "../types";

/**
 * Explicitly deferred big-gun provider. The adapter exists so the V2 router
 * has a stable extension point, but phase 1 cannot call it unless both the
 * feature flag and a key are deliberately configured later.
 */
export class PerplexityDeepResearchProvider implements DeepResearchProvider {
  readonly name = "perplexity" as const;
  readonly enabled =
    process.env.CELL_RESEARCH_PERPLEXITY_ENABLED === "true" &&
    Boolean(process.env.PERPLEXITY_API_KEY);

  async research(_request: DeepResearchRequest): Promise<DeepResearchResponse> {
    if (!this.enabled) {
      throw new ResearchProviderError(
        this.name,
        "Perplexity deep research is disabled for the 3×10 experiment",
      );
    }
    throw new ResearchProviderError(
      this.name,
      "Perplexity is enabled but its live implementation is intentionally deferred",
    );
  }
}
