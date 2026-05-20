import {
  type ComparisonCell,
  type ComparisonParameter,
  type ComparisonTableData,
  TABLE_VIEWER_CSS,
  TIER_LABELS,
  formatDate,
  makeCellKey,
  summarizeCell,
} from "@/lib/table-viewer";

export function buildStandaloneTableHtml(data: ComparisonTableData): string {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const today = new Date().toISOString();
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(data.venture.title)} - VentureX comparison table</title>
  <style>
    ${TABLE_VIEWER_CSS}
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--vx-bg);
      color: var(--vx-text);
    }
  </style>
</head>
<body>
  <script>window.__venturexStartedAt = performance.now();</script>
  <script type="application/json" id="venturex-data">${json}</script>
  ${renderTable(data, today)}
  <div id="vx-modal-root"></div>
  <script>${EXPORT_INTERACTIONS}</script>
</body>
</html>`;
}

export function tableExportFilename(data: ComparisonTableData): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `venturex_${data.venture.slug}_${stamp}.html`;
}

function renderTable(data: ComparisonTableData, exportedAt: string): string {
  const cellsByKey = new Map<string, ComparisonCell>();
  for (const cell of data.cells) {
    cellsByKey.set(makeCellKey(cell.candidate_id, cell.parameter_key), cell);
  }

  const rows = ([1, 2, 3] as const)
    .map((tier) => {
      const parameters = data.parameters.filter((parameter) => parameter.tier === tier);
      return `${renderTierHeader(tier, parameters.length, data.candidates.length)}
${parameters
  .map((parameter) => renderParameterRow(parameter, data, cellsByKey))
  .join("\n")}`;
    })
    .join("\n");

  return `<div class="vx-page">
  <header class="vx-toolbar">
    <h1>${escapeHtml(data.venture.title)} comparison table</h1>
    <div class="vx-toolbar-actions">
      <span class="vx-corner-meta">exported ${escapeHtml(formatDate(exportedAt))}</span>
    </div>
  </header>
  <div class="vx-table-viewport">
    <div class="vx-table-grid" style="--candidate-count: ${data.candidates.length}">
      <div class="vx-corner">
        <div class="vx-brand">VentureX</div>
        <div class="vx-venture-title">${escapeHtml(data.venture.title)}</div>
        <div class="vx-corner-meta">${data.candidates.length} candidates - ${data.cells.length} cells</div>
        <div class="vx-corner-meta">generated ${escapeHtml(formatDate(data.venture.generated_at))}</div>
      </div>
      ${data.candidates.map(renderCandidateHeader).join("\n")}
      ${rows}
    </div>
  </div>
</div>`;
}

function renderCandidateHeader(candidate: ComparisonTableData["candidates"][number]): string {
  const logo = candidate.logo_url
    ? `<img class="vx-logo" src="${escapeAttribute(candidate.logo_url)}" alt="">`
    : `<div class="vx-logo-fallback" aria-hidden="true">${escapeHtml(candidate.name.slice(0, 1).toUpperCase())}</div>`;
  return `<div class="vx-candidate-header">
  <div class="vx-candidate-inner">
    ${logo}
    <div>
      <div class="vx-candidate-name">${escapeHtml(candidate.name)}</div>
      ${candidate.product_line ? `<div class="vx-candidate-meta">${escapeHtml(candidate.product_line)}</div>` : ""}
      <button type="button" class="vx-stats-button" title="Candidate summary modal reserved for V2">${candidate.stats.total} - ${candidate.stats.verified}v - ${candidate.stats.inferred}i - ${candidate.stats.unknown}u</button>
    </div>
  </div>
</div>`;
}

function renderTierHeader(
  tier: 1 | 2 | 3,
  parameterCount: number,
  candidateCount: number,
): string {
  return `<div class="vx-tier-left">
  <button type="button" class="vx-tier-toggle" data-tier-toggle="${tier}" aria-expanded="true">
    <span>${escapeHtml(TIER_LABELS[tier])}</span><span aria-hidden="true">-</span>
  </button>
</div>
<div class="vx-tier-fill" style="grid-column: span ${Math.max(candidateCount, 1)}">${parameterCount} parameters</div>`;
}

function renderParameterRow(
  parameter: ComparisonParameter,
  data: ComparisonTableData,
  cellsByKey: Map<string, ComparisonCell>,
): string {
  const cells = data.candidates
    .map((candidate) => {
      const cell = cellsByKey.get(makeCellKey(candidate.candidate_id, parameter.parameter_key)) ?? null;
      const summary = summarizeCell(cell, parameter);
      return `<div class="vx-data-cell" data-tier-row="${parameter.tier}">
  <button type="button" class="vx-cell-button" data-cell-button data-candidate-id="${escapeAttribute(candidate.candidate_id)}" data-parameter-key="${escapeAttribute(parameter.parameter_key)}" title="${escapeAttribute(summary.title)}">
    <span class="vx-confidence-dot" data-confidence="${cell?.confidence ?? "unknown"}" title="${cell?.confidence ?? "not researched"}"></span>
    <span class="${summary.muted ? "vx-cell-summary vx-cell-summary-muted" : "vx-cell-summary"}">${escapeHtml(summary.text)}</span>
    ${(cell?.citations.length ?? 0) > 0 ? `<span class="vx-citation-mark" title="Citation available">link</span>` : ""}
  </button>
</div>`;
    })
    .join("\n");

  return `<div class="vx-param-cell" data-tier-row="${parameter.tier}" title="${escapeAttribute(parameter.description)}">
  <div class="vx-param-label">
    <span>${escapeHtml(parameter.parameter_label)}</span>
    <span class="vx-tier-badge" data-tier="${parameter.tier}">T${parameter.tier}</span>
  </div>
  <div class="vx-param-key">${escapeHtml(parameter.parameter_key)}</div>
</div>
${cells}`;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: unknown): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

const EXPORT_INTERACTIONS = `
(function () {
  var dataEl = document.getElementById("venturex-data");
  var data = JSON.parse(dataEl.textContent || "{}");
  var modalRoot = document.getElementById("vx-modal-root");
  var opener = null;

  function key(candidateId, parameterKey) {
    return candidateId + "::" + parameterKey;
  }

  var cells = new Map();
  data.cells.forEach(function (cell) {
    cells.set(key(cell.candidate_id, cell.parameter_key), cell);
  });

  function findCandidate(id) {
    return data.candidates.find(function (candidate) {
      return candidate.candidate_id === id;
    });
  }

  function findParameter(parameterKey) {
    return data.parameters.find(function (parameter) {
      return parameter.parameter_key === parameterKey;
    });
  }

  function escape(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(value) {
    if (!value) return "";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toISOString().slice(0, 10);
  }

  function inlineValue(value) {
    if (value == null) return "None";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "number") return new Intl.NumberFormat("en-US").format(value);
    if (Array.isArray(value)) return value.map(inlineValue).join(", ");
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  function humanize(key) {
    return key.replace(/_/g, " ");
  }

  function reasonKind(reason) {
    var lower = (reason || "").toLowerCase();
    if (lower.indexOf("extraction_error") >= 0) return "error";
    if (lower.indexOf("no_evidence_found") >= 0 || lower.indexOf("m13 citations") >= 0) return "warning";
    return "neutral";
  }

  function renderValue(value) {
    if (value == null) return '<p class="vx-modal-prose">None</p>';
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return '<p class="vx-modal-prose">' + escape(inlineValue(value)) + '</p>';
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return '<p class="vx-modal-prose">None</p>';
      return '<ul>' + value.map(function (item) {
        return '<li>' + escape(inlineValue(item)) + '</li>';
      }).join("") + '</ul>';
    }
    if (typeof value === "object") {
      var entries = Object.entries(value);
      if (entries.length <= 8) {
        return '<div class="vx-kv">' + entries.map(function (entry) {
          return '<div class="vx-kv-key">' + escape(humanize(entry[0])) + '</div><div class="vx-kv-value">' + escape(inlineValue(entry[1])) + '</div>';
        }).join("") + '</div>';
      }
      return '<pre class="vx-json">' + escape(JSON.stringify(value, null, 2)) + '</pre>';
    }
    return '<p class="vx-modal-prose">' + escape(String(value)) + '</p>';
  }

  function renderEvidence(cell, parameter) {
    if (!cell) {
      return '<div class="vx-callout" data-kind="warning">Not researched.</div>';
    }
    if (cell.confidence === "unknown" && cell.reason) {
      return '<div class="vx-callout" data-kind="' + reasonKind(cell.reason) + '">' + escape(cell.reason) + '</div>';
    }
    if (cell.citations && cell.citations.length > 0) {
      return cell.citations.map(function (citation) {
        return '<div class="vx-citation"><a class="vx-citation-title" href="' + escape(citation.url) + '" target="_blank" rel="noopener noreferrer">' + escape(citation.source_title || citation.url) + '</a><div class="vx-citation-url">' + escape(citation.url) + '</div>' + (citation.retrieved_at ? '<div class="vx-modal-meta">retrieved ' + escape(formatDate(citation.retrieved_at)) + '</div>' : '') + (citation.snippet ? '<blockquote>' + escape(citation.snippet) + '</blockquote>' : '') + '</div>';
      }).join("");
    }
    if (parameter.tier === 1) {
      return '<p class="vx-modal-prose"><em>Training-data value - no citation required for Tier 1 identity facts.</em></p>';
    }
    return '<div class="vx-callout">No citation attached.</div>';
  }

  function openModal(button) {
    var candidate = findCandidate(button.getAttribute("data-candidate-id"));
    var parameter = findParameter(button.getAttribute("data-parameter-key"));
    if (!candidate || !parameter) return;
    var cell = cells.get(key(candidate.candidate_id, parameter.parameter_key)) || null;
    opener = button;
    modalRoot.innerHTML = '<div class="vx-modal-backdrop" role="presentation" data-modal-backdrop><div class="vx-modal" role="dialog" aria-modal="true" aria-labelledby="vx-modal-title"><div class="vx-modal-header"><div><h2 id="vx-modal-title" class="vx-modal-title">' + escape(parameter.parameter_label) + '</h2><div class="vx-modal-meta">T' + parameter.tier + ' - ' + escape(cell ? cell.confidence : 'not researched') + ' - ' + escape(candidate.name) + '</div></div><button type="button" class="vx-icon-button" data-close-modal aria-label="Close modal">x</button></div><div class="vx-modal-body"><section class="vx-modal-section"><h3 class="vx-modal-section-title">Value</h3>' + (cell ? renderValue(cell.value) : '<div class="vx-callout" data-kind="warning">Not researched. This candidate/parameter pair has no row in the cells table.</div>') + '</section><section class="vx-modal-section"><h3 class="vx-modal-section-title">Evidence</h3>' + renderEvidence(cell, parameter) + '</section></div><div class="vx-modal-footer"><button type="button" class="vx-secondary-button" data-copy-key="' + escape(parameter.parameter_key) + '">Copy parameter key</button><button type="button" class="vx-primary-button" data-close-modal>Close</button></div></div></div>';
    var closeButton = modalRoot.querySelector("[data-close-modal]");
    if (closeButton) closeButton.focus();
  }

  function closeModal() {
    modalRoot.innerHTML = "";
    if (opener) opener.focus();
  }

  document.addEventListener("click", function (event) {
    var cellButton = event.target.closest("[data-cell-button]");
    if (cellButton) {
      openModal(cellButton);
      return;
    }
    var toggle = event.target.closest("[data-tier-toggle]");
    if (toggle) {
      var tier = toggle.getAttribute("data-tier-toggle");
      var expanded = toggle.getAttribute("aria-expanded") !== "false";
      toggle.setAttribute("aria-expanded", expanded ? "false" : "true");
      toggle.querySelector("span:last-child").textContent = expanded ? "+" : "-";
      document.querySelectorAll('[data-tier-row="' + tier + '"]').forEach(function (row) {
        row.classList.toggle("vx-hidden", expanded);
      });
      return;
    }
    if (event.target.closest("[data-close-modal]")) {
      closeModal();
      return;
    }
    var backdrop = event.target.closest("[data-modal-backdrop]");
    if (backdrop && event.target === backdrop) closeModal();
    var copy = event.target.closest("[data-copy-key]");
    if (copy && navigator.clipboard) navigator.clipboard.writeText(copy.getAttribute("data-copy-key"));
  });

  document.addEventListener("keydown", function (event) {
    if (!modalRoot.innerHTML) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key !== "Tab") return;
    var focusable = modalRoot.querySelectorAll('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  window.__venturexRenderMs = performance.now() - (window.__venturexStartedAt || performance.now());
  console.info("VentureX standalone table render: " + Math.round(window.__venturexRenderMs) + "ms");
})();`;
