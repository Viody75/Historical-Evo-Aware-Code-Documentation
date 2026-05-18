import type {
  GeneratedIssueSummary,
  HistoricalExportPayload,
  HistoricalIssueEntry,
  SummaryChangeContrastEntry,
  SnapshotSummaryIndex,
  SummaryWhatChangedEntry,
} from "@/app/history-viewer/types";

function normalizeCommitId(commitId: string) {
  return commitId.trim().toLowerCase();
}

function buildCommitLookup(issue: HistoricalIssueEntry) {
  return new Map(
    issue.commits.map((commit) => [normalizeCommitId(commit.sha), commit.sha]),
  );
}

export function resolveCommitIdsForIssue(
  issue: HistoricalIssueEntry,
  relatedCommitIds: string[],
) {
  const commitLookup = buildCommitLookup(issue);
  const resolved = new Set<string>();

  for (const rawCommitId of relatedCommitIds) {
    const normalized = normalizeCommitId(rawCommitId);
    if (!normalized) {
      continue;
    }

    for (const [fullSha] of commitLookup.entries()) {
      if (fullSha.startsWith(normalized)) {
        resolved.add(commitLookup.get(fullSha) || normalized);
      }
    }
  }

  return [...resolved];
}

export function buildIssueRationaleMap(
  issue: HistoricalIssueEntry,
  issueSummary?: GeneratedIssueSummary | null,
) {
  const rationaleMap = new Map<string, SummaryWhatChangedEntry[]>();
  if (!issueSummary) {
    return rationaleMap;
  }

  for (const entry of issueSummary.whatChanged) {
    for (const resolvedCommitId of resolveCommitIdsForIssue(
      issue,
      entry.relatedCommitIds,
    )) {
      const existing = rationaleMap.get(resolvedCommitId) || [];
      rationaleMap.set(resolvedCommitId, [...existing, entry]);
    }
  }

  return rationaleMap;
}

export function buildSummaryIndexMap(summaryIndex: SnapshotSummaryIndex | null) {
  return new Map(
    (summaryIndex?.issues || []).map((issueSummary) => [
      issueSummary.issueNumber,
      issueSummary,
    ]),
  );
}

function renderList(items: string[]) {
  if (items.length === 0) {
    return "- None";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function renderImpactCell(items: string[]) {
  if (items.length === 0) {
    return "None";
  }

  return items.join("<br />");
}

function ensureBecausePrefix(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return "-";
  }

  if (/^karena\b/i.test(normalized)) {
    return normalized;
  }

  return `Karena ${normalized.charAt(0).toLowerCase()}${normalized.slice(1)}`;
}

function ensureStructuredRationale(value: string) {
  const withBecause = ensureBecausePrefix(value);
  if (withBecause === "-") {
    return withBecause;
  }

  const trimmed = withBecause.replace(/[.!\s]+$/, "");
  const hasEffect =
    /\b(sehingga|maka|jadi|therefore|thus|so that|so )\b/i.test(trimmed);
  const hasSolution =
    /\b(solusi|solution|fix|resolved by|to address this|implemented by)\b/i.test(
      trimmed,
    );

  let nextValue = trimmed;
  if (!hasEffect) {
    nextValue = `${nextValue}, sehingga dampak perubahan dan konteks masalahnya menjadi lebih jelas.`;
  }

  if (!hasSolution) {
    nextValue = `${nextValue} Solusi: perubahan ini menyesuaikan implementasi agar masalah yang dibahas dapat ditangani.`;
  }

  return nextValue;
}

function renderWhatChangedRows(rows: SummaryWhatChangedEntry[]) {
  if (rows.length === 0) {
    return "| No notable changes captured | No rationale captured | - |";
  }

  return rows
    .map(
      (row) =>
        `| ${row.change.replaceAll("\n", " ")} | ${ensureStructuredRationale(row.rationale).replaceAll("\n", " ")} (${row.evidenceSource}; refs: ${row.evidenceRefs.join(", ") || "-"}) | ${row.relatedCommitIds.join(", ")} |`,
    )
    .join("\n");
}

function renderChangeContrastRows(rows: SummaryChangeContrastEntry[]) {
  if (rows.length === 0) {
    return "| - | No contrast captured | No contrast captured | No rationale captured | - |";
  }

  return rows
    .map((row) => {
      const aspect = row.aspect.replaceAll("\n", " ");
      const before = row.before.replaceAll("\n", " ");
      const after = row.after.replaceAll("\n", " ");
      const rationale = ensureStructuredRationale(
        row.rationale || row.reason || "-",
      ).replaceAll("\n", " ");
      const evidence = `${row.evidenceSource}; refs: ${row.evidenceRefs.join(", ") || "-"}; commits: ${row.relatedCommitIds.join(", ") || "-"}`.replaceAll(
        "\n",
        " ",
      );

      return `| ${aspect} | ${before} | ${after} | ${rationale} | ${evidence} |`;
    })
    .join("\n");
}

function renderImpactRows(issueSummary: Omit<GeneratedIssueSummary, "markdown">) {
  return [
    `| User | ${renderImpactCell(issueSummary.impact.user)} |`,
    `| System | ${renderImpactCell(issueSummary.impact.system)} |`,
    `| Developer | ${renderImpactCell(issueSummary.impact.developer)} |`,
  ].join("\n");
}

export function renderIssueSummaryMarkdown(
  template: string,
  issueSummary: Omit<GeneratedIssueSummary, "markdown">,
) {
  return template
    .replaceAll("{{title}}", issueSummary.title)
    .replaceAll("{{related_issue}}", issueSummary.relatedIssue || "-")
    .replaceAll("{{pull_request}}", issueSummary.pullRequest)
    .replaceAll("{{background}}", issueSummary.background)
    .replaceAll(
      "{{what_changed_rows}}",
      renderWhatChangedRows(issueSummary.whatChanged),
    )
    .replaceAll(
      "{{change_contrast_rows}}",
      renderChangeContrastRows(issueSummary.changeContrast || []),
    )
    .replaceAll(
      "{{change_size}}",
      issueSummary.changeSize
        ? `${issueSummary.changeSize.level} - ${ensureStructuredRationale(issueSummary.changeSize.rationale)}`
        : "-",
    )
    .replaceAll("{{impact_rows}}", renderImpactRows(issueSummary))
    .replaceAll(
      "{{testing_verification}}",
      renderList(issueSummary.testingVerification),
    )
    .replaceAll("{{notes}}", renderList(issueSummary.notes));
}

export function summarizeIssueContext(payload: HistoricalExportPayload) {
  return payload.issues.map((issue) => ({
    issueNumber: issue.issueNumber,
    title: issue.title,
    commits: issue.commits.length,
  }));
}
