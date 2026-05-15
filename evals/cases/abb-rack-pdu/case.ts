import type { EvalCase } from "../../types";

/**
 * Keystone test case (CLAUDE.md §13). Real Innovera consulting venture,
 * lightly anonymized for the eval framework. Source documents live in
 * `test-cases/abb-rack-pdu/` (shared with M3-era manual parser tests).
 *
 * The `user_provided_description` simulates what a consultant would type
 * into `/ventures/new` — short, paraphrased, identity-stripped. The detail
 * lives in the documents.
 */
export const abbRackPduCase: EvalCase = {
  id: "abb-rack-pdu",
  name: "ABB Rack PDU",
  user_provided_description:
    "A major electrical-equipment company is evaluating entry into rack-mounted PDU for high-density (AI-era) data centers. The parent has deep electrical-distribution heritage but no current presence in IT-channel rack PDU. Need to assess strategic fit, competitive landscape, and substitution risk.",
  documents_dir: "test-cases/abb-rack-pdu",
  expected_profile_path: "test-cases/abb-rack-pdu/expected_profile.json",
};
