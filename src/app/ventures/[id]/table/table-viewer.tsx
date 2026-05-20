"use client";

import { Download, ExternalLink, Link as LinkIcon, X } from "lucide-react";
import Link from "next/link";
import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type ComparisonCandidate,
  type ComparisonCell,
  type ComparisonParameter,
  type ComparisonTableData,
  TABLE_VIEWER_CSS,
  TIER_LABELS,
  formatDate,
  formatInlineValue,
  humanizeKey,
  makeCellKey,
  reasonKind,
  summarizeCell,
} from "@/lib/table-viewer";

interface SelectedCell {
  candidate: ComparisonCandidate;
  parameter: ComparisonParameter;
  cell: ComparisonCell | null;
}

export function ComparisonTableViewer({
  data,
  ventureId,
}: {
  data: ComparisonTableData;
  ventureId: string;
}) {
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const cellsByKey = useMemo(() => {
    const map = new Map<string, ComparisonCell>();
    for (const cell of data.cells) {
      map.set(makeCellKey(cell.candidate_id, cell.parameter_key), cell);
    }
    return map;
  }, [data.cells]);

  const parametersByTier = useMemo(() => {
    return ([1, 2, 3] as const).map((tier) => ({
      tier,
      parameters: data.parameters.filter((parameter) => parameter.tier === tier),
    }));
  }, [data.parameters]);

  useEffect(() => {
    if (typeof performance !== "undefined") {
      console.info(
        `VentureX table mounted in ${Math.round(performance.now())}ms`,
      );
    }
  }, []);

  function toggleTier(tier: number) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(tier)) next.delete(tier);
      else next.add(tier);
      return next;
    });
  }

  function openCell(
    candidate: ComparisonCandidate,
    parameter: ComparisonParameter,
    event: MouseEvent<HTMLElement>,
  ) {
    openerRef.current = event.currentTarget;
    setSelected({
      candidate,
      parameter,
      cell: cellsByKey.get(makeCellKey(candidate.candidate_id, parameter.parameter_key)) ?? null,
    });
  }

  function closeModal() {
    setSelected(null);
    window.requestAnimationFrame(() => openerRef.current?.focus());
  }

  const cellCount = data.cells.length;

  return (
    <div className="vx-page">
      <style dangerouslySetInnerHTML={{ __html: TABLE_VIEWER_CSS }} />
      <header className="vx-toolbar">
        <h1>{data.venture.title} comparison table</h1>
        <div className="vx-toolbar-actions">
          <Link href={`/ventures/${ventureId}`} className="vx-link-button">
            Venture
          </Link>
          <a
            href={`/api/ventures/${ventureId}/table/export.csv`}
            className="vx-secondary-button"
          >
            <Download size={14} aria-hidden="true" />
            Download CSV
          </a>
          <a
            href={`/api/ventures/${ventureId}/table/export`}
            className="vx-primary-button"
          >
            <Download size={14} aria-hidden="true" />
            Download HTML
          </a>
        </div>
      </header>

      <div className="vx-table-viewport">
        <div
          className="vx-table-grid"
          style={
            {
              "--candidate-count": data.candidates.length,
            } as CSSProperties
          }
        >
          <CornerCell data={data} cellCount={cellCount} />
          {data.candidates.map((candidate) => (
            <CandidateHeader key={candidate.candidate_id} candidate={candidate} />
          ))}

          {parametersByTier.map(({ tier, parameters }) => (
            <TableTier
              key={tier}
              tier={tier}
              parameters={parameters}
              candidates={data.candidates}
              cellsByKey={cellsByKey}
              collapsed={collapsed.has(tier)}
              onToggle={() => toggleTier(tier)}
              onOpenCell={openCell}
            />
          ))}
        </div>
      </div>

      {selected && <CellModal selected={selected} onClose={closeModal} />}
    </div>
  );
}

function CornerCell({
  data,
  cellCount,
}: {
  data: ComparisonTableData;
  cellCount: number;
}) {
  return (
    <div className="vx-corner">
      <div className="vx-brand">VentureX</div>
      <div className="vx-venture-title">{data.venture.title}</div>
      <div className="vx-corner-meta">
        {data.candidates.length} candidates - {cellCount} cells
      </div>
      <div className="vx-corner-meta">
        generated {formatDate(data.venture.generated_at)}
      </div>
    </div>
  );
}

function CandidateHeader({ candidate }: { candidate: ComparisonCandidate }) {
  return (
    <div className="vx-candidate-header">
      <div className="vx-candidate-inner">
        {candidate.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="vx-logo" src={candidate.logo_url} alt="" />
        ) : (
          <div className="vx-logo-fallback" aria-hidden="true">
            {candidate.name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div>
          <div className="vx-candidate-name">{candidate.name}</div>
          {candidate.product_line && (
            <div className="vx-candidate-meta">{candidate.product_line}</div>
          )}
          <button
            type="button"
            className="vx-stats-button"
            title="Candidate summary modal reserved for V2"
            aria-label={`${candidate.name} summary reserved for V2`}
          >
            {candidate.stats.total} - {candidate.stats.verified}v -{" "}
            {candidate.stats.inferred}i - {candidate.stats.unknown}u
          </button>
        </div>
      </div>
    </div>
  );
}

function TableTier({
  tier,
  parameters,
  candidates,
  cellsByKey,
  collapsed,
  onToggle,
  onOpenCell,
}: {
  tier: 1 | 2 | 3;
  parameters: ComparisonParameter[];
  candidates: ComparisonCandidate[];
  cellsByKey: Map<string, ComparisonCell>;
  collapsed: boolean;
  onToggle: () => void;
  onOpenCell: (
    candidate: ComparisonCandidate,
    parameter: ComparisonParameter,
    event: MouseEvent<HTMLElement>,
  ) => void;
}) {
  return (
    <>
      <div className="vx-tier-left">
        <button
          type="button"
          className="vx-tier-toggle"
          onClick={onToggle}
          aria-expanded={!collapsed}
        >
          <span>{TIER_LABELS[tier]}</span>
          <span aria-hidden="true">{collapsed ? "+" : "-"}</span>
        </button>
      </div>
      <div
        className="vx-tier-fill"
        style={{ gridColumn: `span ${Math.max(candidates.length, 1)}` }}
      >
        {parameters.length} parameters
      </div>

      {!collapsed &&
        parameters.map((parameter) => (
          <ParameterRow
            key={parameter.parameter_key}
            parameter={parameter}
            candidates={candidates}
            cellsByKey={cellsByKey}
            onOpenCell={onOpenCell}
          />
        ))}
    </>
  );
}

function ParameterRow({
  parameter,
  candidates,
  cellsByKey,
  onOpenCell,
}: {
  parameter: ComparisonParameter;
  candidates: ComparisonCandidate[];
  cellsByKey: Map<string, ComparisonCell>;
  onOpenCell: (
    candidate: ComparisonCandidate,
    parameter: ComparisonParameter,
    event: MouseEvent<HTMLElement>,
  ) => void;
}) {
  return (
    <>
      <div className="vx-param-cell" title={parameter.description}>
        <div className="vx-param-label">
          <span>{parameter.parameter_label}</span>
          <span className="vx-tier-badge" data-tier={parameter.tier}>
            T{parameter.tier}
          </span>
        </div>
        <div className="vx-param-key">{parameter.parameter_key}</div>
      </div>
      {candidates.map((candidate) => {
        const cell =
          cellsByKey.get(makeCellKey(candidate.candidate_id, parameter.parameter_key)) ??
          null;
        const summary = summarizeCell(cell, parameter);
        return (
          <div
            className="vx-data-cell"
            key={`${candidate.candidate_id}-${parameter.parameter_key}`}
          >
            <button
              type="button"
              className="vx-cell-button"
              title={summary.title}
              onClick={(event) => onOpenCell(candidate, parameter, event)}
            >
              <span
                className="vx-confidence-dot"
                data-confidence={cell?.confidence ?? "unknown"}
                title={cell?.confidence ?? "not researched"}
              />
              <span
                className={
                  summary.muted
                    ? "vx-cell-summary vx-cell-summary-muted"
                    : "vx-cell-summary"
                }
              >
                {summary.text}
              </span>
              {(cell?.citations.length ?? 0) > 0 && (
                <span className="vx-citation-mark" title="Citation available">
                  <LinkIcon size={13} aria-hidden="true" />
                </span>
              )}
            </button>
          </div>
        );
      })}
    </>
  );
}

function CellModal({
  selected,
  onClose,
}: {
  selected: SelectedCell;
  onClose: () => void;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { cell, candidate, parameter } = selected;

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  function onBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function copyKey() {
    await navigator.clipboard?.writeText(parameter.parameter_key);
  }

  return (
    <div
      className="vx-modal-backdrop"
      role="presentation"
      onMouseDown={onBackdropClick}
      onKeyDown={onKeyDown}
    >
      <div
        className="vx-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vx-modal-title"
        ref={modalRef}
      >
        <div className="vx-modal-header">
          <div>
            <h2 id="vx-modal-title" className="vx-modal-title">
              {parameter.parameter_label}
            </h2>
            <div className="vx-modal-meta">
              T{parameter.tier} - {cell?.confidence ?? "not researched"} -{" "}
              {candidate.name}
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="vx-icon-button"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="vx-modal-body">
          <section className="vx-modal-section">
            <h3 className="vx-modal-section-title">Value</h3>
            {cell ? <ModalValue value={cell.value} /> : <MissingCell />}
          </section>

          <section className="vx-modal-section">
            <h3 className="vx-modal-section-title">Evidence</h3>
            <EvidenceBlock cell={cell} parameter={parameter} />
          </section>
        </div>

        <div className="vx-modal-footer">
          <button type="button" className="vx-secondary-button" onClick={copyKey}>
            Copy parameter key
          </button>
          <button type="button" className="vx-primary-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <p className="vx-modal-prose">None</p>;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <p className="vx-modal-prose">{formatInlineValue(value)}</p>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <p className="vx-modal-prose">None</p>;
    return (
      <ul>
        {value.map((item, index) => (
          <li key={index}>{renderNestedValue(item)}</li>
        ))}
      </ul>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length <= 8) {
      return (
        <div className="vx-kv">
          {entries.map(([key, entryValue]) => (
            <Fragment key={key}>
              <div className="vx-kv-key">{humanizeKey(key)}</div>
              <div className="vx-kv-value">{renderNestedValue(entryValue)}</div>
            </Fragment>
          ))}
        </div>
      );
    }
    return <pre className="vx-json">{JSON.stringify(value, null, 2)}</pre>;
  }
  return <p className="vx-modal-prose">{String(value)}</p>;
}

function renderNestedValue(value: unknown): ReactNode {
  if (value === null || value === undefined) return "None";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return formatInlineValue(value);
  }
  if (Array.isArray(value)) return value.map(formatInlineValue).join(", ");
  if (typeof value === "object") return <pre className="vx-json">{JSON.stringify(value, null, 2)}</pre>;
  return String(value);
}

function MissingCell() {
  return (
    <div className="vx-callout" data-kind="warning">
      Not researched. This candidate/parameter pair has no row in the cells
      table.
    </div>
  );
}

function EvidenceBlock({
  cell,
  parameter,
}: {
  cell: ComparisonCell | null;
  parameter: ComparisonParameter;
}) {
  if (!cell) {
    return (
      <div className="vx-callout" data-kind="warning">
        Not researched.
      </div>
    );
  }
  if (cell.confidence === "unknown" && cell.reason) {
    return (
      <div className="vx-callout" data-kind={reasonKind(cell.reason)}>
        {cell.reason}
      </div>
    );
  }
  if (cell.citations.length > 0) {
    return (
      <>
        {cell.citations.map((citation, index) => (
          <div className="vx-citation" key={`${citation.url}-${index}`}>
            <a
              className="vx-citation-title"
              href={citation.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {citation.source_title}
              <ExternalLink size={13} aria-hidden="true" />
            </a>
            <div className="vx-citation-url">{citation.url}</div>
            {citation.retrieved_at && (
              <div className="vx-modal-meta">
                retrieved {formatDate(citation.retrieved_at)}
              </div>
            )}
            {citation.snippet && <blockquote>{citation.snippet}</blockquote>}
          </div>
        ))}
      </>
    );
  }
  if (parameter.tier === 1) {
    return (
      <p className="vx-modal-prose">
        <em>Training-data value - no citation required for Tier 1 identity facts.</em>
      </p>
    );
  }
  return <div className="vx-callout">No citation attached.</div>;
}
