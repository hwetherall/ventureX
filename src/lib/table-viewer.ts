import type { CellConfidence } from "@/types/cell";
import type { Parameter, ParameterTier, ParameterValueType } from "@/types/parameter";

export type ComparisonTier = 1 | 2 | 3;
export type ComparisonValueShape = "string" | "number" | "object" | "array";

export interface ComparisonCitation {
  source_title: string;
  url: string;
  snippet: string;
  retrieved_at: string;
}

export interface ComparisonVenture {
  id: string;
  slug: string;
  title: string;
  generated_at: string;
}

export interface ComparisonCandidate {
  candidate_id: string;
  name: string;
  product_line: string | null;
  logo_url: string | null;
  stats: {
    total: number;
    verified: number;
    inferred: number;
    unknown: number;
  };
}

export interface ComparisonParameter {
  parameter_key: string;
  parameter_label: string;
  tier: ComparisonTier;
  description: string;
  value_shape: ComparisonValueShape;
  summary_keys?: string[];
}

export interface ComparisonCell {
  candidate_id: string;
  parameter_key: string;
  tier: ComparisonTier;
  confidence: CellConfidence;
  value: unknown;
  citations: ComparisonCitation[];
  reason: string | null;
  retrieved_at: string | null;
}

export interface ComparisonTableData {
  venture: ComparisonVenture;
  candidates: ComparisonCandidate[];
  parameters: ComparisonParameter[];
  cells: ComparisonCell[];
}

export const TABLE_VIEWER_CSS = `
:root {
  --vx-bg: var(--color-background, #fafafa);
  --vx-surface: var(--color-surface, #ffffff);
  --vx-surface-raised: var(--color-surface-elevated, #f4f4f5);
  --vx-text: var(--color-foreground, #18181b);
  --vx-muted: var(--color-muted-foreground, #71717a);
  --vx-border: var(--color-border, #e4e4e7);
  --vx-hover: color-mix(in srgb, var(--vx-surface-raised) 70%, transparent);
  --vx-verified: #059669;
  --vx-inferred: #d97706;
  --vx-unknown: #9ca3af;
  --vx-error: var(--color-error-fg, #b91c1c);
  --vx-warning-bg: var(--color-warning-bg, #fffbeb);
  --vx-warning-fg: var(--color-warning-fg, #b45309);
  --vx-focus: var(--color-ring, #818cf8);
}

.vx-page {
  min-height: 100vh;
  background: var(--vx-bg);
  color: var(--vx-text);
}

.vx-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 24px;
  border-bottom: 1px solid var(--vx-border);
  background: var(--vx-bg);
}

.vx-toolbar h1 {
  margin: 0;
  font-size: 18px;
  line-height: 1.2;
  font-weight: 600;
  letter-spacing: 0;
}

.vx-toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.vx-link-button,
.vx-secondary-button,
.vx-primary-button,
.vx-icon-button {
  border: 1px solid var(--vx-border);
  border-radius: 4px;
  background: var(--vx-surface);
  color: var(--vx-text);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  text-decoration: none;
  cursor: pointer;
}

.vx-link-button,
.vx-secondary-button,
.vx-primary-button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 32px;
  padding: 0 10px;
}

.vx-primary-button {
  background: var(--vx-text);
  border-color: var(--vx-text);
  color: var(--vx-bg);
}

.vx-icon-button {
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
}

.vx-link-button:hover,
.vx-secondary-button:hover,
.vx-icon-button:hover {
  background: var(--vx-surface-raised);
}

.vx-primary-button:hover {
  opacity: 0.9;
}

.vx-link-button:focus-visible,
.vx-secondary-button:focus-visible,
.vx-primary-button:focus-visible,
.vx-icon-button:focus-visible,
.vx-cell-button:focus-visible,
.vx-tier-toggle:focus-visible {
  outline: 2px solid var(--vx-focus);
  outline-offset: -2px;
}

.vx-table-viewport {
  height: calc(100vh - 69px);
  overflow: auto;
  overscroll-behavior: contain;
}

.vx-table-grid {
  display: grid;
  grid-template-columns: 240px repeat(var(--candidate-count), 280px);
  align-items: stretch;
  min-width: calc(240px + (var(--candidate-count) * 280px));
}

.vx-corner,
.vx-candidate-header,
.vx-param-cell,
.vx-tier-left,
.vx-tier-fill,
.vx-data-cell {
  box-sizing: border-box;
  border-right: 1px solid var(--vx-border);
  border-bottom: 1px solid var(--vx-border);
  background: var(--vx-surface);
}

.vx-corner {
  position: sticky;
  top: 0;
  left: 0;
  z-index: 6;
  height: 96px;
  padding: 12px 14px;
  border-right-color: var(--vx-text);
  border-bottom-color: var(--vx-text);
}

.vx-brand {
  font-size: 11px;
  line-height: 1.2;
  color: var(--vx-muted);
  text-transform: uppercase;
  letter-spacing: .08em;
}

.vx-venture-title {
  margin-top: 7px;
  font-size: 15px;
  line-height: 1.25;
  font-weight: 600;
}

.vx-corner-meta,
.vx-candidate-meta,
.vx-param-key,
.vx-modal-meta,
.vx-citation-url {
  color: var(--vx-muted);
  font-size: 11px;
  line-height: 1.35;
}

.vx-corner-meta {
  margin-top: 4px;
}

.vx-candidate-header {
  position: sticky;
  top: 0;
  z-index: 5;
  height: 96px;
  padding: 12px 14px;
}

.vx-candidate-inner {
  display: grid;
  grid-template-columns: 40px 1fr;
  gap: 10px;
  align-items: center;
  height: 100%;
}

.vx-logo,
.vx-logo-fallback {
  width: 40px;
  height: 40px;
  border: 1px solid var(--vx-border);
  border-radius: 4px;
  object-fit: contain;
  background: var(--vx-surface-raised);
}

.vx-logo-fallback {
  display: grid;
  place-items: center;
  color: var(--vx-muted);
  font-weight: 600;
}

.vx-candidate-name {
  font-size: 15px;
  line-height: 1.2;
  font-weight: 600;
}

.vx-stats-button {
  display: block;
  margin: 4px 0 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--vx-muted);
  font: inherit;
  font-size: 11px;
  line-height: 1.35;
  text-align: left;
  cursor: default;
}

.vx-tier-left,
.vx-tier-fill {
  min-height: 48px;
  background: var(--vx-surface-raised);
}

.vx-tier-left {
  position: sticky;
  left: 0;
  z-index: 4;
  padding: 0;
  border-right-color: var(--vx-text);
}

.vx-tier-toggle {
  display: flex;
  width: 100%;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 0;
  background: transparent;
  color: var(--vx-text);
  padding: 0 14px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.vx-tier-fill {
  display: flex;
  align-items: center;
  padding: 0 14px;
  color: var(--vx-muted);
  font-size: 12px;
}

.vx-param-cell {
  position: sticky;
  left: 0;
  z-index: 3;
  min-height: 96px;
  padding: 12px 14px;
  border-right-color: var(--vx-text);
}

.vx-param-label {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  font-size: 14px;
  line-height: 1.35;
  font-weight: 500;
}

.vx-tier-badge {
  flex: 0 0 auto;
  border: 1px solid var(--vx-border);
  border-radius: 4px;
  padding: 1px 5px;
  color: var(--vx-muted);
  font-size: 10px;
  line-height: 1.4;
  font-weight: 600;
}

.vx-tier-badge[data-tier="1"] { border-color: #a7f3d0; }
.vx-tier-badge[data-tier="2"] { border-color: #fde68a; }
.vx-tier-badge[data-tier="3"] { border-color: #c7d2fe; }

.vx-param-key {
  margin-top: 6px;
  font-family: var(--font-plex-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  overflow-wrap: anywhere;
}

.vx-data-cell {
  position: relative;
  min-height: 96px;
  padding: 0;
}

.vx-cell-button {
  position: relative;
  display: block;
  width: 100%;
  min-height: 95px;
  height: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  padding: 12px 14px;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.vx-cell-button:hover {
  background: var(--vx-hover);
}

.vx-cell-summary {
  max-height: 66px;
  padding-right: 18px;
  overflow: hidden;
  color: var(--vx-text);
  font-size: 13px;
  line-height: 1.45;
}

.vx-cell-summary-muted {
  color: var(--vx-muted);
  font-style: italic;
}

.vx-confidence-dot {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--vx-unknown);
}

.vx-confidence-dot[data-confidence="verified"] { background: var(--vx-verified); }
.vx-confidence-dot[data-confidence="inferred"] { background: var(--vx-inferred); }
.vx-confidence-dot[data-confidence="unknown"] { background: var(--vx-unknown); }

.vx-citation-mark {
  position: absolute;
  right: 12px;
  bottom: 10px;
  color: var(--vx-muted);
  font-size: 13px;
}

.vx-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.42);
}

.vx-modal {
  width: min(720px, 100%);
  max-height: 80vh;
  overflow: auto;
  border: 1px solid var(--vx-border);
  border-radius: 4px;
  background: var(--vx-surface);
  box-shadow: 0 24px 60px rgba(0,0,0,.20);
}

.vx-modal-header,
.vx-modal-footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px;
}

.vx-modal-header {
  border-bottom: 1px solid var(--vx-border);
}

.vx-modal-title {
  margin: 0;
  font-size: 18px;
  line-height: 1.25;
  font-weight: 600;
}

.vx-modal-body {
  padding: 22px 24px 24px;
  font-size: 15px;
  line-height: 1.6;
}

.vx-modal-section + .vx-modal-section {
  margin-top: 22px;
}

.vx-modal-section-title {
  margin: 0 0 8px;
  color: var(--vx-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .08em;
  line-height: 1.4;
  text-transform: uppercase;
}

.vx-kv {
  display: grid;
  grid-template-columns: minmax(120px, 200px) 1fr;
  gap: 8px 14px;
}

.vx-kv-key {
  color: var(--vx-muted);
  font-family: var(--font-plex-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.vx-kv-value,
.vx-modal-prose {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.vx-json {
  overflow: auto;
  border: 1px solid var(--vx-border);
  border-radius: 4px;
  background: var(--vx-surface-raised);
  padding: 12px;
  font-family: var(--font-plex-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  line-height: 1.5;
}

.vx-citation {
  border: 1px solid var(--vx-border);
  border-radius: 4px;
  padding: 12px;
}

.vx-citation + .vx-citation {
  margin-top: 10px;
}

.vx-citation-title {
  color: var(--vx-text);
  font-weight: 600;
  text-decoration: none;
}

.vx-citation-title:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.vx-citation-url {
  margin-top: 3px;
  font-family: var(--font-plex-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  overflow-wrap: anywhere;
}

.vx-citation blockquote {
  margin: 10px 0 0;
  border-left: 2px solid var(--vx-border);
  padding-left: 10px;
  color: var(--vx-muted);
  font-size: 13px;
  line-height: 1.55;
}

.vx-callout {
  border: 1px solid var(--vx-border);
  border-radius: 4px;
  padding: 12px;
  color: var(--vx-muted);
  background: var(--vx-surface-raised);
}

.vx-callout[data-kind="warning"] {
  border-color: var(--color-warning-border, #fde68a);
  color: var(--vx-warning-fg);
  background: var(--vx-warning-bg);
}

.vx-callout[data-kind="error"] {
  border-color: var(--color-error-border, #fecaca);
  color: var(--vx-error);
  background: var(--color-error-bg, #fef2f2);
}

.vx-modal-footer {
  border-top: 1px solid var(--vx-border);
}

.vx-hidden {
  display: none !important;
}
`;

export const TIER_LABELS: Record<ComparisonTier, string> = {
  1: "Tier 1 - Universal",
  2: "Tier 2 - Framework",
  3: "Tier 3 - Dynamic",
};

export function tierToNumber(tier: ParameterTier | ComparisonTier): ComparisonTier {
  if (tier === "universal") return 1;
  if (tier === "framework") return 2;
  if (tier === "dynamic") return 3;
  return tier;
}

export function valueTypeToShape(valueType: ParameterValueType): ComparisonValueShape {
  if (valueType === "number") return "number";
  if (valueType === "object") return "object";
  if (valueType === "list") return "array";
  return "string";
}

export function parameterToComparison(parameter: Parameter): ComparisonParameter {
  return {
    parameter_key: parameter.id,
    parameter_label: parameter.name,
    tier: tierToNumber(parameter.tier),
    description: parameter.prompt_hint,
    value_shape: valueTypeToShape(parameter.value_type),
  };
}

export function makeCellKey(candidateId: string, parameterKey: string): string {
  return `${candidateId}::${parameterKey}`;
}

/** Parameters whose numeric values are identifiers, not quantities (no grouping). */
const PLAIN_INTEGER_PARAMETER_KEYS = new Set(["founded_year"]);

export function formatDisplayNumber(value: number, parameterKey?: string): string {
  if (parameterKey && PLAIN_INTEGER_PARAMETER_KEYS.has(parameterKey)) {
    return String(value);
  }
  return new Intl.NumberFormat("en-US").format(value);
}

export function summarizeCell(
  cell: ComparisonCell | null,
  parameter: ComparisonParameter,
): { text: string; muted: boolean; title: string } {
  if (!cell) {
    return {
      text: "-",
      muted: true,
      title: "Not researched",
    };
  }

  if (cell.value === null || cell.value === undefined) {
    if (cell.reason) {
      const text = summarizeReason(cell.reason);
      return { text, muted: true, title: cell.reason };
    }
    return { text: "None", muted: false, title: "No value" };
  }

  const value = cell.value;
  if (typeof value === "string") {
    const text = value.length < 120 ? value : firstSentence(value);
    return { text, muted: false, title: value };
  }
  if (typeof value === "number") {
    const text = formatDisplayNumber(value, parameter.parameter_key);
    return { text, muted: false, title: text };
  }
  if (typeof value === "boolean") {
    const text = value ? "Yes" : "No";
    return { text, muted: false, title: text };
  }
  if (Array.isArray(value)) {
    const text = summarizeArray(value);
    return { text, muted: false, title: JSON.stringify(value) };
  }
  if (typeof value === "object") {
    const text = summarizeObject(value as Record<string, unknown>, parameter);
    return { text, muted: false, title: JSON.stringify(value) };
  }

  const text = String(value);
  return { text, muted: false, title: text };
}

export function summarizeReason(reason: string): string {
  const lower = reason.toLowerCase();
  if (lower.startsWith("extraction_error") || lower.includes("extraction_error")) {
    return "Extraction failed.";
  }
  if (lower.includes("supplied m13 citations") || lower.includes("m13 citations")) {
    return "Gap in M13 evidence.";
  }
  if (lower.includes("no_evidence_found")) {
    return "No supporting evidence found.";
  }
  return reason;
}

export function reasonKind(reason: string | null): "error" | "warning" | "neutral" {
  if (!reason) return "neutral";
  const lower = reason.toLowerCase();
  if (lower.startsWith("extraction_error") || lower.includes("extraction_error")) {
    return "error";
  }
  if (lower.includes("no_evidence_found") || lower.includes("m13 citations")) {
    return "warning";
  }
  return "neutral";
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 10);
}

export function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "venture";
}

function firstSentence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(.{1,180}?[.!?])(\s|$)/);
  if (match?.[1]) return `${match[1]} ...`;
  return `${trimmed.slice(0, 160)} ...`;
}

function summarizeArray(value: unknown[]): string {
  if (value.length === 0) return "None";
  if (value.every((item) => typeof item === "string")) {
    const head = value.slice(0, 3).join(" - ");
    const more = value.length > 3 ? ` +${value.length - 3} more` : "";
    return `${head}${more}`;
  }
  if (value.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
    const first = value[0] as Record<string, unknown>;
    const primary = pickPrimaryObjectValue(first);
    return `${value.length} entries${primary ? ` - most recent: ${primary}` : ""}`;
  }
  return `${value.length} entries`;
}

function summarizeObject(
  value: Record<string, unknown>,
  parameter: ComparisonParameter,
): string {
  const keys = Object.keys(value);
  if (keys.length === 0) return "None";
  const summaryKeys =
    parameter.summary_keys?.filter((key) => key in value).slice(0, 3) ??
    keys.slice(0, keys.length <= 3 ? 3 : 2);
  const selected = summaryKeys.length > 0 ? summaryKeys : keys.slice(0, 2);
  return selected
    .map((key) => `${humanizeKey(key)}: ${formatInlineValue(value[key])}`)
    .join("\n");
}

function pickPrimaryObjectValue(value: Record<string, unknown>): string {
  for (const key of ["summary", "name", "title", "event", "description", "year"]) {
    const candidate = value[key];
    if (candidate !== undefined && candidate !== null) {
      return formatInlineValue(candidate);
    }
  }
  const first = Object.values(value).find((entry) => entry !== undefined && entry !== null);
  return first === undefined ? "" : formatInlineValue(first);
}

export function formatInlineValue(value: unknown, parameterKey?: string): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "string") return value;
  if (typeof value === "number") return formatDisplayNumber(value, parameterKey);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(formatInlineValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function humanizeKey(key: string): string {
  return key.replace(/_/g, " ");
}
