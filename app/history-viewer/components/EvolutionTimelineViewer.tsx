"use client";

import { useMemo, useState } from "react";

import { RationaleSections } from "@/app/history-viewer/components/RationaleSections";
import { DiffParser } from "@/app/history-viewer/lib/comparator";
import {
  buildIssueRationaleMap,
  buildSummaryIndexMap,
  resolveCommitIdsForIssue,
} from "@/app/history-viewer/lib/historySummary";
import type {
  GeneratedIssueSummary,
  HistoricalCommitEntry,
  HistoricalExportPayload,
  HistoricalIssueEntry,
  SnapshotNavigationTarget,
  SnapshotSummaryIndex,
  SummaryChangeContrastEntry,
  SummarySignificanceFlag,
  SummaryWhatChangedEntry,
} from "@/app/history-viewer/types";

type TimelineCommitEvent = {
  id: string;
  issue: HistoricalIssueEntry;
  commit: HistoricalCommitEntry;
  issueSummary: GeneratedIssueSummary | null;
  rationales: SummaryWhatChangedEntry[];
  changeContrast: SummaryChangeContrastEntry[];
  significanceFlags: SummarySignificanceFlag[];
};

function commitMatchesIssueEntry(
  issue: HistoricalIssueEntry,
  commitSha: string,
  relatedCommitIds: string[],
) {
  const resolvedIds = resolveCommitIdsForIssue(issue, relatedCommitIds);
  if (resolvedIds.includes(commitSha)) {
    return true;
  }

  const normalizedCommit = commitSha.toLowerCase();
  return relatedCommitIds.some((relatedId) => {
    const normalizedRelated = relatedId.trim().toLowerCase();
    return (
      normalizedRelated.length > 0 &&
      (normalizedCommit.startsWith(normalizedRelated) ||
        normalizedRelated.startsWith(normalizedCommit))
    );
  });
}

function buildTimelineEvents(
  payload: HistoricalExportPayload,
  summaryIndex: SnapshotSummaryIndex | null,
) {
  const summaryByIssue = buildSummaryIndexMap(summaryIndex);

  return payload.issues
    .flatMap((issue) => {
      const issueSummary = summaryByIssue.get(issue.issueNumber) || null;
      const rationaleByCommit = buildIssueRationaleMap(issue, issueSummary);

      return issue.commits.map<TimelineCommitEvent>((commit) => ({
        id: `${issue.issueNumber}-${commit.sha}`,
        issue,
        commit,
        issueSummary,
        rationales: rationaleByCommit.get(commit.sha) || [],
        changeContrast:
          issueSummary?.changeContrast?.filter((entry) =>
            commitMatchesIssueEntry(
              issue,
              commit.sha,
              entry.relatedCommitIds,
            ),
          ) || [],
        significanceFlags:
          issueSummary?.significanceFlags?.filter((entry) =>
            commitMatchesIssueEntry(
              issue,
              commit.sha,
              entry.relatedCommitIds,
            ),
          ) || [],
      }));
    })
    .sort(
      (first, second) =>
        new Date(second.commit.committedAt).getTime() -
        new Date(first.commit.committedAt).getTime(),
    );
}

function shortSha(sha: string) {
  return sha.slice(0, 7);
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function getSignificanceTone(significance: string) {
  switch (significance) {
    case "Crucial":
      return "border-rose-200 bg-rose-50 text-rose-800";
    case "Medium":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "Low":
      return "border-sky-200 bg-sky-50 text-sky-800";
    case "None":
      return "border-slate-200 bg-slate-50 text-slate-600";
    default:
      return "border-slate-200 bg-white text-slate-600";
  }
}

export function EvolutionTimelineViewer({
  payload,
  summaryIndex,
  onNavigateTarget,
}: {
  payload: HistoricalExportPayload;
  summaryIndex: SnapshotSummaryIndex | null;
  onNavigateTarget: (target: SnapshotNavigationTarget) => void;
}) {
  const events = useMemo(
    () => buildTimelineEvents(payload, summaryIndex),
    [payload, summaryIndex],
  );
  const issueOptions = useMemo(
    () =>
      payload.issues
        .map((issue) => ({
          issueNumber: issue.issueNumber,
          title: issue.title,
          commitCount: issue.commits.length,
        }))
        .sort((first, second) => second.issueNumber - first.issueNumber),
    [payload.issues],
  );
  const [selectedIssueNumber, setSelectedIssueNumber] = useState<number | null>(
    null,
  );
  const filteredEvents = useMemo(
    () =>
      selectedIssueNumber
        ? events.filter(
            (event) => event.issue.issueNumber === selectedIssueNumber,
          )
        : events,
    [events, selectedIssueNumber],
  );
  const [selectedEventId, setSelectedEventId] = useState(
    filteredEvents[0]?.id || "",
  );
  const selectedEvent =
    filteredEvents.find((event) => event.id === selectedEventId) ||
    filteredEvents[0] ||
    null;
  const [expandedRationaleKey, setExpandedRationaleKey] = useState("");
  const [selectedPatchFile, setSelectedPatchFile] = useState("");
  const activePatch =
    selectedEvent?.commit.codeChanges.find(
      (change) => change.filename === selectedPatchFile,
    ) ||
    selectedEvent?.commit.codeChanges[0] ||
    null;
  const patchRows = activePatch
    ? DiffParser.parsePatchRows(activePatch.patch).slice(0, 120)
    : [];

  if (events.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
        No commit timeline is available in this snapshot.
      </div>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-slate-200 bg-slate-50">
        <div className="border-b border-slate-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Issue Scope
          </p>
          <div className="mt-3 grid gap-2">
            <button
              type="button"
              onClick={() => setSelectedIssueNumber(null)}
              className={`rounded-xl border px-3 py-2 text-left text-sm ${
                selectedIssueNumber === null
                  ? "border-slate-900 bg-white text-slate-950"
                  : "border-slate-200 bg-white text-slate-600 hover:text-slate-950"
              }`}
            >
              All issues
              <span className="ml-2 text-xs text-slate-400">
                {events.length} commits
              </span>
            </button>
            <div className="max-h-56 overflow-y-auto pr-1">
              {issueOptions.map((issue) => (
                <button
                  key={issue.issueNumber}
                  type="button"
                  onClick={() => setSelectedIssueNumber(issue.issueNumber)}
                  className={`mt-2 block w-full rounded-xl border px-3 py-2 text-left ${
                    selectedIssueNumber === issue.issueNumber
                      ? "border-slate-900 bg-white text-slate-950"
                      : "border-slate-200 bg-white text-slate-600 hover:text-slate-950"
                  }`}
                >
                  <span className="block text-xs font-semibold">
                    PR #{issue.issueNumber}
                  </span>
                  <span className="mt-1 line-clamp-2 block text-sm">
                    {issue.title}
                  </span>
                  <span className="mt-1 block text-xs text-slate-400">
                    {issue.commitCount} commit
                    {issue.commitCount === 1 ? "" : "s"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="max-h-[620px] overflow-y-auto p-4">
          <div className="relative space-y-3 pl-4">
            <div className="absolute bottom-3 left-[21px] top-3 w-px bg-slate-200" />
            {filteredEvents.map((event) => {
              const isActive = event.id === selectedEvent?.id;

              return (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => setSelectedEventId(event.id)}
                  className="relative grid w-full grid-cols-[18px_minmax(0,1fr)] gap-3 text-left"
                >
                  <span
                    className={`relative z-10 mt-4 h-3 w-3 rounded-full border ${
                      isActive
                        ? "border-slate-950 bg-slate-950"
                        : "border-slate-300 bg-white"
                    }`}
                  />
                  <span
                    className={`rounded-xl border px-3 py-3 transition-colors ${
                      isActive
                        ? "border-slate-900 bg-white shadow-sm"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-semibold text-slate-950">
                        {event.commit.message.split("\n")[0]}
                      </span>
                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                        {shortSha(event.commit.sha)}
                      </span>
                    </span>
                    <span className="mt-2 block text-xs text-slate-500">
                      {formatDate(event.commit.committedAt)}
                    </span>
                    <span className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                      <span>PR #{event.issue.issueNumber}</span>
                      <span>{event.commit.codeChanges.length} file</span>
                      <span>{event.rationales.length} rationale</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      <section className="min-w-0 rounded-2xl border border-slate-200 bg-white">
        {selectedEvent ? (
          <div className="grid min-h-[620px] xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="border-b border-slate-200 p-5 xl:border-b-0 xl:border-r">
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                  PR #{selectedEvent.issue.issueNumber}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                  {shortSha(selectedEvent.commit.sha)}
                </span>
              </div>

              <h3 className="mt-4 text-lg font-semibold text-slate-950">
                {selectedEvent.commit.message.split("\n")[0]}
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {selectedEvent.issue.title}
              </p>
              <p className="mt-3 text-xs text-slate-500">
                {selectedEvent.commit.author} •{" "}
                {formatDate(selectedEvent.commit.committedAt)}
              </p>

              {selectedEvent.significanceFlags.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {selectedEvent.significanceFlags.slice(0, 6).map((flag, index) => (
                    <span
                      key={`${flag.change}-${flag.significance}-${index}`}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${getSignificanceTone(
                        flag.significance,
                      )}`}
                    >
                      {flag.significance}: {flag.change}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="mt-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Rationale
                </p>
                {selectedEvent.rationales.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {selectedEvent.rationales.map((entry, index) => {
                      const key = `${selectedEvent.id}-rationale-${index}`;
                      const isExpanded = expandedRationaleKey === key;

                      return (
                        <div
                          key={key}
                          className="rounded-xl border border-slate-200 bg-white"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedRationaleKey(isExpanded ? "" : key)
                            }
                            className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-slate-50"
                          >
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold text-slate-950">
                                {entry.change}
                              </span>
                              <span className="mt-1 block text-xs text-slate-500">
                                Click to inspect cause, effect, solution, and source
                              </span>
                            </span>
                            <span className="text-lg text-slate-400">
                              {isExpanded ? "-" : "+"}
                            </span>
                          </button>
                          {isExpanded ? (
                            <div className="border-t border-slate-200 bg-slate-50 px-3 py-3">
                              <RationaleSections
                                value={entry.rationale}
                                compact
                              />
                              <div className="mt-3 rounded-lg bg-white px-3 py-2 text-xs leading-5 text-slate-600">
                                <div className="font-semibold uppercase tracking-[0.14em] text-slate-400">
                                  Source
                                </div>
                                <div className="mt-1">{entry.evidenceSource}</div>
                                <div className="mt-1 break-words">
                                  refs: {entry.evidenceRefs.join(", ") || "-"}
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">
                    No generated rationale is linked to this commit yet.
                  </p>
                )}
              </div>

              {selectedEvent.changeContrast.length > 0 ? (
                <div className="mt-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Change Contrast
                  </p>
                  <div className="mt-3 space-y-2">
                    {selectedEvent.changeContrast.slice(0, 4).map((entry, index) => (
                      <div
                        key={`${selectedEvent.id}-contrast-${index}`}
                        className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-950">
                            {entry.change}
                          </span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-xs ${getSignificanceTone(
                              entry.significance,
                            )}`}
                          >
                            {entry.significance}
                          </span>
                        </div>
                        <div className="mt-2 grid gap-2 text-xs leading-5 text-slate-600 md:grid-cols-2">
                          <div>
                            <span className="font-semibold text-slate-500">
                              Before:
                            </span>{" "}
                            {entry.before}
                          </div>
                          <div>
                            <span className="font-semibold text-slate-500">
                              After:
                            </span>{" "}
                            {entry.after}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="min-w-0 p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Code Snippet
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Patch files involved in this commit.
                  </p>
                </div>
                {activePatch ? (
                  <button
                    type="button"
                    onClick={() =>
                      onNavigateTarget({
                        issueNumber: selectedEvent.issue.issueNumber,
                        commitSha: selectedEvent.commit.sha,
                        filePath: activePatch.filename,
                        label: activePatch.filename,
                      })
                    }
                    className="rounded-xl bg-slate-950 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                  >
                    Open in Repo Viewer
                  </button>
                ) : null}
              </div>

              {selectedEvent.commit.codeChanges.length > 0 ? (
                <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                  {selectedEvent.commit.codeChanges.map((change) => (
                    <button
                      key={`${selectedEvent.id}-${change.filename}`}
                      type="button"
                      onClick={() => setSelectedPatchFile(change.filename)}
                      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium ${
                        activePatch?.filename === change.filename
                          ? "border-slate-950 bg-slate-950 text-white"
                          : "border-slate-200 bg-white text-slate-600 hover:text-slate-950"
                      }`}
                    >
                      {change.filename}
                    </button>
                  ))}
                </div>
              ) : null}

              {activePatch ? (
                <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
                  <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                    {activePatch.filename}
                  </div>
                  <div className="max-h-[560px] overflow-auto">
                    {patchRows.map((row, index) => (
                      <div
                        key={`${activePatch.filename}-${index}`}
                        className="grid grid-cols-2 border-b border-slate-100 font-mono text-xs"
                      >
                        <div
                          className={`grid grid-cols-[56px_minmax(0,1fr)] border-r border-slate-200 ${DiffParser.getPaneClass(
                            row.kind,
                            "before",
                            row.beforeLineNumber !== null ||
                              row.beforeText.length > 0,
                          )}`}
                        >
                          <span className="border-r border-slate-200 px-3 py-1 text-right text-slate-400">
                            {row.beforeLineNumber ?? ""}
                          </span>
                          <pre className="overflow-x-auto px-3 py-1 whitespace-pre-wrap">
                            {row.beforeText || " "}
                          </pre>
                        </div>
                        <div
                          className={`grid grid-cols-[56px_minmax(0,1fr)] ${DiffParser.getPaneClass(
                            row.kind,
                            "after",
                            row.afterLineNumber !== null ||
                              row.afterText.length > 0,
                          )}`}
                        >
                          <span className="border-r border-slate-200 px-3 py-1 text-right text-slate-400">
                            {row.afterLineNumber ?? ""}
                          </span>
                          <pre className="overflow-x-auto px-3 py-1 whitespace-pre-wrap">
                            {row.afterText || " "}
                          </pre>
                        </div>
                      </div>
                    ))}
                    {DiffParser.parsePatchRows(activePatch.patch).length >
                    patchRows.length ? (
                      <div className="bg-slate-50 px-3 py-2 text-xs text-slate-500">
                        Patch preview is clipped to the first {patchRows.length}{" "}
                        rows. Open in Repo Viewer for deeper exploration.
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  This commit has no patch snippet in the exported history.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="px-4 py-6 text-sm text-slate-500">
            Choose a timeline item to inspect its rationale and code snippet.
          </div>
        )}
      </section>
    </div>
  );
}
