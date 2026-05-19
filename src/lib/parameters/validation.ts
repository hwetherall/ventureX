import { HARDCODED_PARAMETERS } from "@/lib/parameters/catalog";
import type {
  DynamicParameter,
  Parameter,
  Stage4ParameterBuilderOutput,
} from "@/types/parameter";
import type { VentureProfile } from "@/types/venture-profile";

const ANALYSIS_BLOCKLIST =
  /strength|weakness|sentiment|satisfaction|culture|vision|mission/i;

export class ParameterValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParameterValidationError";
  }
}

export function validateParameterBuilderOutput(
  output: Stage4ParameterBuilderOutput,
  profile: VentureProfile,
): DynamicParameter[] {
  const params = output.dynamic_parameters;

  if (params.length < 10 || params.length > 20) {
    throw new ParameterValidationError(
      `Dynamic parameter count ${params.length} outside [10, 20].`,
    );
  }

  assertUniqueIds(params);
  assertNoHardcodedDuplicates(params);
  assertNoMetaDimensions(params);
  assertNoAnalysisParameters(params);
  assertSourceFieldsResolve(params, profile);
  assertSubstitutionCoverage(params, profile);
  assertRiskCoverage(params, profile);

  return params;
}

function assertUniqueIds(params: DynamicParameter[]): void {
  const seen = new Set<string>();
  for (const p of params) {
    if (seen.has(p.id)) {
      throw new ParameterValidationError(`Duplicate dynamic parameter id: ${p.id}`);
    }
    seen.add(p.id);
  }
}

function assertNoHardcodedDuplicates(params: DynamicParameter[]): void {
  const hardcodedIds: Set<string> = new Set(
    HARDCODED_PARAMETERS.map((p) => p.id),
  );
  const duplicates = params.filter((p) => hardcodedIds.has(p.id));
  if (duplicates.length > 0) {
    throw new ParameterValidationError(
      `Dynamic parameter id duplicates hardcoded parameter: ${duplicates
        .map((p) => p.id)
        .join(", ")}`,
    );
  }
}

function assertNoMetaDimensions(params: DynamicParameter[]): void {
  const offenders = params.filter(
    (p) => (p as { innovera_dimension: string }).innovera_dimension === "meta",
  );
  if (offenders.length > 0) {
    throw new ParameterValidationError(
      `Dynamic parameters cannot use innovera_dimension='meta': ${offenders
        .map((p) => p.id)
        .join(", ")}`,
    );
  }
}

function assertNoAnalysisParameters(params: DynamicParameter[]): void {
  const offenders = params.filter(
    (p) =>
      p.value_type === "prose" &&
      p.cell_budget === "paragraph" &&
      ANALYSIS_BLOCKLIST.test(p.name),
  );
  if (offenders.length > 0) {
    throw new ParameterValidationError(
      `Analysis-like dynamic parameters are not allowed: ${offenders
        .map((p) => p.id)
        .join(", ")}`,
    );
  }
}

function assertSourceFieldsResolve(
  params: DynamicParameter[],
  profile: VentureProfile,
): void {
  for (const p of params) {
    if (resolveJsonPath(profile, p.source_field) === undefined) {
      throw new ParameterValidationError(
        `source_field does not resolve for ${p.id}: ${p.source_field}`,
      );
    }
  }
}

function assertSubstitutionCoverage(
  params: DynamicParameter[],
  profile: VentureProfile,
): void {
  const substitutions =
    profile.dimensions.product_solution.substitution_landscape;

  for (let i = 0; i < substitutions.length; i++) {
    const expected = `dimensions.product_solution.substitution_landscape[${i}]`;
    const matches = params.filter((p) => p.source_field === expected);
    if (matches.length !== 1) {
      throw new ParameterValidationError(
        `Expected exactly one dynamic parameter for ${expected}; found ${matches.length}.`,
      );
    }
  }
}

function assertRiskCoverage(
  params: DynamicParameter[],
  profile: VentureProfile,
): void {
  for (let i = 0; i < profile.strategic_risks_and_uncertainties.length; i++) {
    const prefix = `strategic_risks_and_uncertainties[${i}]`;
    const matches = params.filter((p) => p.source_field.startsWith(prefix));
    if (matches.length === 0) {
      throw new ParameterValidationError(
        `Expected at least one dynamic parameter sourced from ${prefix}.`,
      );
    }
  }
}

export function assertUniqueParameterIds(parameters: Parameter[]): void {
  const seen = new Set<string>();
  for (const p of parameters) {
    if (seen.has(p.id)) {
      throw new ParameterValidationError(`Duplicate parameter id: ${p.id}`);
    }
    seen.add(p.id);
  }
}

export function resolveJsonPath(root: unknown, path: string): unknown {
  if (!path || path.startsWith("$")) return undefined;

  const tokens = path.match(/[^.[\]]+|\[(\d+)\]/g);
  if (!tokens) return undefined;

  let current = root;
  for (const token of tokens) {
    if (token.startsWith("[")) {
      const index = Number(token.slice(1, -1));
      if (!Array.isArray(current) || !Number.isInteger(index)) {
        return undefined;
      }
      current = current[index];
      continue;
    }

    if (
      current === null ||
      typeof current !== "object" ||
      !(token in current)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[token];
  }

  return current;
}
