"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { PanelIcon } from "@/app/history-viewer/components/PanelIcon";
import { DiffParser, FileTreeBuilder } from "@/app/history-viewer/lib/comparator";
import {
  buildIssueRationaleMap,
  buildSummaryIndexMap,
} from "@/app/history-viewer/lib/historySummary";
import { GitHubHistoryApi } from "@/app/history-viewer/lib/GitHubHistoryApi";
import type {
  DiffRow,
  HistoricalExportPayload,
  PullRequestFile,
  SnapshotNavigationTarget,
  SnapshotRecord,
  SnapshotRepoFileContent,
  SnapshotRepoFileEntry,
  SnapshotSummaryIndex,
  SummaryWhatChangedEntry,
} from "@/app/history-viewer/types";

type RepoActivityEntry = {
  id: string;
  issueNumber: number;
  issueTitle: string;
  commitSha: string;
  commitMessage: string;
  author: string;
  committedAt: string;
  file: PullRequestFile;
  rationales: SummaryWhatChangedEntry[];
};

type HighlightRange = {
  start: number;
  end: number;
};

type RepoFileFilterMode = "all" | "issue" | "commit";

type SnippetRow =
  | {
      kind: "separator";
    }
  | {
      kind: "line";
      lineNumber: number;
      text: string;
      isFocused: boolean;
    };

function buildRepoFilePatchMap(
  payload: HistoricalExportPayload,
  summaryIndex: SnapshotSummaryIndex | null,
) {
  const activityMap = new Map<string, RepoActivityEntry[]>();
  const summaryIndexMap = buildSummaryIndexMap(summaryIndex);

  for (const issue of payload.issues) {
    const issueRationaleMap = buildIssueRationaleMap(
      issue,
      summaryIndexMap.get(issue.issueNumber) || null,
    );

    for (const commit of issue.commits) {
      for (const change of commit.codeChanges) {
        const nextEntry: RepoActivityEntry = {
          id: `${issue.issueNumber}-${commit.sha}-${change.filename}`,
          issueNumber: issue.issueNumber,
          issueTitle: issue.title,
          commitSha: commit.sha,
          commitMessage: commit.message,
          author: commit.author,
          committedAt: commit.committedAt,
          file: {
            filename: change.filename,
            patch: change.patch,
            status: "tracked",
          },
          rationales: issueRationaleMap.get(commit.sha) || [],
        };

        const existing = activityMap.get(change.filename) || [];
        activityMap.set(change.filename, [...existing, nextEntry]);
      }
    }
  }

  return activityMap;
}

function parsePatchHunks(rows: DiffRow[]) {
  const hunks: DiffRow[][] = [];
  let currentHunk: DiffRow[] = [];

  for (const row of rows) {
    if (row.beforeText.startsWith("@@") && row.afterText.startsWith("@@")) {
      if (currentHunk.length > 0) {
        hunks.push(currentHunk);
      }
      currentHunk = [];
      continue;
    }

    currentHunk.push(row);
  }

  if (currentHunk.length > 0) {
    hunks.push(currentHunk);
  }

  return hunks;
}

function buildHighlightRanges(content: string, patch: string): HighlightRange[] {
  if (!content || !patch) {
    return [];
  }

  const contentLines = content.split("\n");
  const hunks = parsePatchHunks(DiffParser.parsePatchRows(patch));
  const ranges: HighlightRange[] = [];
  let searchCursor = 0;

  for (const hunk of hunks) {
    const candidateLines = hunk
      .filter((row) => row.kind !== "delete")
      .map((row) => row.afterText.trim())
      .filter((line) => line.length > 0 && !line.startsWith("@@"));

    const firstCandidate = candidateLines.find((line) => line.length >= 3);
    if (!firstCandidate) {
      continue;
    }

    let foundIndex = contentLines.findIndex(
      (line, index) => index >= searchCursor && line.includes(firstCandidate),
    );

    if (foundIndex < 0) {
      foundIndex = contentLines.findIndex((line) => line.includes(firstCandidate));
    }

    if (foundIndex < 0) {
      continue;
    }

    const visibleLineCount = Math.max(
      1,
      hunk.filter((row) => row.kind !== "delete").length,
    );
    const nextRange = {
      start: foundIndex + 1,
      end: foundIndex + visibleLineCount,
    };

    ranges.push(nextRange);
    searchCursor = nextRange.end;
  }

  return ranges;
}

function mergeHighlightRanges(ranges: HighlightRange[]) {
  if (ranges.length === 0) {
    return [];
  }

  const sortedRanges = [...ranges].sort((left, right) => left.start - right.start);
  const merged: HighlightRange[] = [{ ...sortedRanges[0] }];

  for (const range of sortedRanges.slice(1)) {
    const last = merged[merged.length - 1];
    if (range.start <= last.end + 3) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  return merged;
}

function buildSnippetRows(content: string, ranges: HighlightRange[]): SnippetRow[] {
  if (!content || ranges.length === 0) {
    return [];
  }

  const lines = content.split("\n");
  const mergedRanges = mergeHighlightRanges(ranges);
  const snippetRows: SnippetRow[] = [];

  mergedRanges.forEach((range, index) => {
    const start = Math.max(1, range.start - 2);
    const end = Math.min(lines.length, range.end + 2);

    if (index > 0) {
      snippetRows.push({ kind: "separator" });
    }

    for (let lineNumber = start; lineNumber <= end; lineNumber += 1) {
      snippetRows.push({
        kind: "line",
        lineNumber,
        text: lines[lineNumber - 1] || "",
        isFocused: lineNumber >= range.start && lineNumber <= range.end,
      });
    }
  });

  return snippetRows;
}

function isLineHighlighted(lineNumber: number, ranges: HighlightRange[]) {
  return ranges.some((range) => lineNumber >= range.start && lineNumber <= range.end);
}

function createRepoFileTree(files: SnapshotRepoFileEntry[]) {
  return FileTreeBuilder.build(
    files.map((file) => ({
      filename: file.path,
      patch: "",
      status: `${Math.max(1, Math.round(file.size / 1024))} KB`,
    })),
  );
}

export function SnapshotRepoViewer({
  snapshot,
  payload,
  summaryIndex,
  navigationTarget,
}: {
  snapshot: SnapshotRecord;
  payload: HistoricalExportPayload;
  summaryIndex?: SnapshotSummaryIndex | null;
  navigationTarget: SnapshotNavigationTarget | null;
}) {
  const [repoFiles, setRepoFiles] = useState<SnapshotRepoFileEntry[]>([]);
  const [repoFilesLoading, setRepoFilesLoading] = useState(true);
  const [repoFilesError, setRepoFilesError] = useState("");
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [selectedActivityId, setSelectedActivityId] = useState("");
  const [fileContent, setFileContent] = useState<SnapshotRepoFileContent | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [repoFileFilterMode, setRepoFileFilterMode] =
    useState<RepoFileFilterMode>("all");
  const [viewerMode, setViewerMode] = useState<"file" | "diff">("file");
  const lineRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const activityMap = useMemo(
    () => buildRepoFilePatchMap(payload, summaryIndex || null),
    [payload, summaryIndex],
  );
  const activeIssueNumber =
    navigationTarget?.issueNumber ?? null;
  const activeCommitSha =
    navigationTarget?.commitSha ?? null;

  const filteredRepoFiles = useMemo(() => {
    if (repoFileFilterMode === "commit" && activeCommitSha) {
      const filePaths = new Set(
        payload.issues
          .flatMap((issue) => issue.commits)
          .filter((commit) => commit.sha === activeCommitSha)
          .flatMap((commit) => commit.codeChanges.map((change) => change.filename)),
      );
      return repoFiles.filter((file) => filePaths.has(file.path));
    }

    if (repoFileFilterMode === "issue" && activeIssueNumber) {
      const filePaths = new Set(
        payload.issues
          .filter((issue) => issue.issueNumber === activeIssueNumber)
          .flatMap((issue) =>
            issue.commits.flatMap((commit) =>
              commit.codeChanges.map((change) => change.filename),
            ),
          ),
      );
      return repoFiles.filter((file) => filePaths.has(file.path));
    }

    return repoFiles;
  }, [activeCommitSha, activeIssueNumber, payload.issues, repoFileFilterMode, repoFiles]);

  const fileTree = useMemo(() => createRepoFileTree(filteredRepoFiles), [filteredRepoFiles]);
  const selectedActivities = useMemo(
    () => activityMap.get(selectedFilePath) || [],
    [activityMap, selectedFilePath],
  );
  const resolvedSelectedActivityId = selectedActivities.some(
    (entry) => entry.id === selectedActivityId,
  )
    ? selectedActivityId
    : selectedActivities[0]?.id || "";
  const selectedActivity =
    selectedActivities.find((entry) => entry.id === resolvedSelectedActivityId) ||
    null;

  useEffect(() => {
    const loadFiles = async () => {
      setRepoFilesLoading(true);
      setRepoFilesError("");

      try {
        const files = await GitHubHistoryApi.fetchSnapshotRepoFiles(snapshot.id);
        setRepoFiles(files);
        setSelectedFilePath((prev) => prev || files[0]?.path || "");
      } catch (error) {
        setRepoFilesError(
          error instanceof Error ? error.message : "Failed to load repo files",
        );
      } finally {
        setRepoFilesLoading(false);
      }
    };

    void loadFiles();
  }, [snapshot.id]);

  useEffect(() => {
    if (!selectedFilePath) {
      return;
    }

    const loadFile = async () => {
      setFileLoading(true);
      setFileError("");

      try {
        const content = await GitHubHistoryApi.fetchSnapshotRepoFileContent(
          snapshot.id,
          selectedFilePath,
        );
        setFileContent(content);
      } catch (error) {
        setFileError(
          error instanceof Error ? error.message : "Failed to load file content",
        );
      } finally {
        setFileLoading(false);
      }
    };

    void loadFile();
  }, [snapshot.id, selectedFilePath]);

  useEffect(() => {
    if (!navigationTarget) {
      return;
    }

    let nextFilePath = navigationTarget.filePath || "";

    if (!nextFilePath && navigationTarget.commitSha) {
      nextFilePath =
        payload.issues
          .flatMap((issue) => issue.commits)
          .find((commit) => commit.sha === navigationTarget.commitSha)
          ?.codeChanges[0]?.filename || "";
    }

    if (!nextFilePath && navigationTarget.issueNumber) {
      nextFilePath =
        payload.issues
          .find((issue) => issue.issueNumber === navigationTarget.issueNumber)
          ?.commits.flatMap((commit) => commit.codeChanges)[0]?.filename || "";
    }

    const animationFrame = window.requestAnimationFrame(() => {
      if (nextFilePath) {
        setSelectedFilePath(nextFilePath);
      }

      if (navigationTarget.commitSha) {
        setRepoFileFilterMode("commit");
        const nextActivity = (
          activityMap.get(nextFilePath) || []
        ).find((entry) => entry.commitSha === navigationTarget.commitSha);
        setSelectedActivityId(nextActivity?.id || "");
        return;
      }

      if (navigationTarget.issueNumber) {
        setRepoFileFilterMode("issue");
        const nextActivity = (
          activityMap.get(nextFilePath) || []
        ).find((entry) => entry.issueNumber === navigationTarget.issueNumber);
        setSelectedActivityId(nextActivity?.id || "");
      }
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [activityMap, navigationTarget, payload.issues]);

  const highlightRanges = useMemo(() => {
    if (!fileContent || !selectedActivity) {
      return [];
    }

    return buildHighlightRanges(fileContent.content, selectedActivity.file.patch);
  }, [fileContent, selectedActivity]);

  const focusedLine = highlightRanges[0]?.start ?? null;
  const snippetRows = useMemo(() => {
    if (!fileContent) {
      return [];
    }

    return buildSnippetRows(fileContent.content, highlightRanges);
  }, [fileContent, highlightRanges]);
  const selectedDiffRows = selectedActivity
    ? DiffParser.parsePatchRows(selectedActivity.file.patch)
    : [];
  const selectedRationales = selectedActivity?.rationales || [];

  useEffect(() => {
    if (!focusedLine) {
      return;
    }

    const element = lineRefs.current[focusedLine];
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusedLine]);

  const codeLines = fileContent?.content.split("\n") || [];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              <PanelIcon name="folder" />
              Repository Viewer
            </p>
            <h4 className="mt-1 text-lg font-semibold text-slate-950">
              Explore current repo snapshot with historical context
            </h4>
            <p className="mt-1 text-sm text-slate-600">
              File di tengah adalah kondisi repo snapshot saat ini. Panel kanan
              memperlihatkan commit, author, dan issue yang pernah menyentuh file itu.
            </p>
          </div>
          <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
            {repoFiles.length} repo files
          </div>
        </div>
      </div>

      <div className="grid gap-0 xl:grid-cols-[280px_minmax(0,1fr)_360px]">
        <div className="border-b border-slate-200 bg-slate-50 xl:border-b-0 xl:border-r">
          <div className="border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Snapshot Files
          </div>
          <div className="max-h-[760px] overflow-y-auto py-2">
            {repoFilesLoading ? (
              <div className="px-4 py-6 text-sm text-slate-500">Loading files...</div>
            ) : repoFilesError ? (
              <div className="px-4 py-6 text-sm text-rose-600">{repoFilesError}</div>
            ) : (
              <>
                <div className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="grid grid-cols-3 gap-2 rounded-xl bg-white p-1">
                    {([
                      ["all", "All files"],
                      ["issue", "Issue files"],
                      ["commit", "Commit files"],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() => setRepoFileFilterMode(value)}
                        className={`rounded-lg px-2 py-2 text-xs font-medium ${
                          repoFileFilterMode === value
                            ? "bg-slate-900 text-white"
                            : "text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {(activeIssueNumber || activeCommitSha) && repoFileFilterMode !== "all" ? (
                    <p className="mt-2 text-xs text-slate-500">
                      Filter locked to{" "}
                      {repoFileFilterMode === "commit"
                        ? `commit ${activeCommitSha?.slice(0, 7)}`
                        : `PR #${activeIssueNumber}`}
                    </p>
                  ) : null}
                </div>
                {FileTreeBuilder.render(
                  fileTree,
                  selectedFilePath,
                  (filename) => setSelectedFilePath(filename),
                  () => <PanelIcon name="folder" />,
                  () => <PanelIcon name="file" />,
                )}
              </>
            )}
          </div>
        </div>

        <div className="min-w-0 border-b border-slate-200 xl:border-b-0 xl:border-r">
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {selectedFilePath || "No file selected"}
                </p>
                {navigationTarget?.label ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Focused from tree: {navigationTarget.label}
                  </p>
                ) : null}
                {selectedRationales.length > 0 ? (
                  <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-700">
                      Linked rationale
                    </p>
                    <div className="mt-2 space-y-2">
                      {selectedRationales.map((entry, index) => (
                        <div key={`${selectedActivity?.id}-rationale-${index}`}>
                          <p className="text-sm font-medium text-rose-950">
                            {entry.change}
                          </p>
                          <p className="mt-1 text-sm text-rose-900">
                            {entry.rationale}
                          </p>
                          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-rose-700">
                            Source: {entry.evidenceSource}
                          </p>
                          <p className="mt-1 text-xs text-rose-800">
                            Evidence refs: {entry.evidenceRefs.join(", ") || "-"}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
                {([
                  ["file", "Full file"],
                  ["diff", "Patch focus"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setViewerMode(value)}
                    className={`rounded-lg px-3 py-2 text-xs font-medium ${
                      viewerMode === value
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-600"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="max-h-[760px] overflow-auto">
            {fileLoading ? (
              <div className="px-4 py-6 text-sm text-slate-500">Loading file content...</div>
            ) : fileError ? (
              <div className="px-4 py-6 text-sm text-rose-600">{fileError}</div>
            ) : fileContent?.isBinary ? (
              <div className="px-4 py-6 text-sm text-slate-500">
                This file looks binary, so the text viewer is disabled.
              </div>
            ) : fileContent ? (
              viewerMode === "file" ? (
                <>
                  <div className="grid grid-cols-[72px_minmax(0,1fr)] border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    <div className="border-r border-slate-200 px-4 py-2">Line</div>
                    <div className="px-4 py-2">Current file snapshot</div>
                  </div>
                  {codeLines.map((line, index) => {
                    const lineNumber = index + 1;
                    const isFocused = isLineHighlighted(lineNumber, highlightRanges);

                    return (
                      <div
                        key={`${selectedFilePath}-${lineNumber}`}
                        ref={(element) => {
                          lineRefs.current[lineNumber] = element;
                        }}
                        className={`grid grid-cols-[72px_minmax(0,1fr)] border-b border-slate-100 font-mono text-xs ${
                          isFocused ? "bg-amber-50" : "bg-white"
                        }`}
                      >
                        <span className="border-r border-slate-200 px-4 py-1 text-right text-slate-400">
                          {lineNumber}
                        </span>
                        <pre className="overflow-x-auto px-4 py-1 whitespace-pre-wrap text-slate-700">
                          {line || " "}
                        </pre>
                      </div>
                    );
                  })}
                </>
              ) : (
                <div className="grid gap-0 xl:grid-cols-2">
                  <div className="border-b border-slate-200 xl:border-b-0 xl:border-r">
                    <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Current code around matched hunks
                    </div>
                    {snippetRows.length > 0 ? (
                      snippetRows.map((row, index) =>
                        row.kind === "separator" ? (
                          <div
                            key={`separator-${index}`}
                            className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-400"
                          >
                            ...
                          </div>
                        ) : (
                          <div
                            key={`snippet-${row.lineNumber}`}
                            className={`grid grid-cols-[72px_minmax(0,1fr)] border-b border-slate-100 font-mono text-xs ${
                              row.isFocused ? "bg-amber-50" : "bg-white"
                            }`}
                          >
                            <span className="border-r border-slate-200 px-4 py-1 text-right text-slate-400">
                              {row.lineNumber}
                            </span>
                            <pre className="overflow-x-auto px-4 py-1 whitespace-pre-wrap text-slate-700">
                              {row.text || " "}
                            </pre>
                          </div>
                        ),
                      )
                    ) : (
                      <div className="px-4 py-6 text-sm text-slate-500">
                        No matched hunk found in the current file snapshot.
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Patch-focused diff
                    </div>
                    {selectedActivity ? (
                      <>
                        {selectedRationales.length > 0 ? (
                          <div className="border-b border-rose-200 bg-rose-50 px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-700">
                              Why this changed
                            </p>
                            <div className="mt-2 space-y-2">
                              {selectedRationales.map((entry, index) => (
                                <div
                                  key={`${selectedActivity.id}-diff-rationale-${index}`}
                                  className="rounded-xl border border-rose-200 bg-white px-3 py-3"
                                >
                                  <p className="text-sm font-medium text-slate-900">
                                    {entry.change}
                                  </p>
                                  <p className="mt-1 text-sm text-slate-600">
                                    {entry.rationale}
                                  </p>
                                  <p className="mt-2 text-xs text-slate-500">
                                    Source: {entry.evidenceSource}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    Evidence refs: {entry.evidenceRefs.join(", ") || "-"}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    Related commit IDs: {entry.relatedCommitIds.join(", ")}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        <div className="grid grid-cols-2 border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          <div className="border-r border-slate-200 px-4 py-2">Before</div>
                          <div className="px-4 py-2">After</div>
                        </div>
                        {selectedDiffRows.map((row, index) => (
                          <div
                            key={`${selectedActivity.id}-${index}`}
                            className="grid grid-cols-2 border-b border-slate-100 font-mono text-xs"
                          >
                            <div
                              className={`grid grid-cols-[56px_minmax(0,1fr)] border-r border-slate-200 ${DiffParser.getPaneClass(
                                row.kind,
                                "before",
                                row.beforeLineNumber !== null || row.beforeText.length > 0,
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
                                row.afterLineNumber !== null || row.afterText.length > 0,
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
                      </>
                    ) : (
                      <div className="px-4 py-6 text-sm text-slate-500">
                        Select an activity to inspect its patch snippet.
                      </div>
                    )}
                  </div>
                </div>
              )
            ) : (
              <div className="px-4 py-6 text-sm text-slate-500">
                Choose a file from the left panel.
              </div>
            )}
          </div>
        </div>

        <div className="bg-slate-50">
          <div className="border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            History on this file
          </div>

          <div className="max-h-[760px] space-y-3 overflow-y-auto p-4">
            {selectedActivities.length > 0 ? (
              selectedActivities.map((activity) => (
                <button
                  key={activity.id}
                  onClick={() => setSelectedActivityId(activity.id)}
                  className={`w-full rounded-2xl border p-4 text-left ${
                    selectedActivity?.id === activity.id
                      ? "border-amber-500 bg-white shadow-sm ring-2 ring-amber-100"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                      PR #{activity.issueNumber}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                      {activity.commitSha.slice(0, 7)}
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-semibold text-slate-900">
                    {activity.commitMessage.split("\n")[0]}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {activity.author} •{" "}
                    {new Date(activity.committedAt).toLocaleString("id-ID")}
                  </p>
                  <p className="mt-3 line-clamp-2 text-sm text-slate-600">
                    {activity.issueTitle}
                  </p>
                  {activity.rationales.length > 0 ? (
                    <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-700">
                        Rationale
                      </p>
                      <div className="mt-2 space-y-2">
                        {activity.rationales.map((entry, index) => (
                          <div key={`${activity.id}-card-rationale-${index}`}>
                            <p className="text-sm font-medium text-rose-950">
                              {entry.change}
                            </p>
                            <p className="mt-1 text-sm text-rose-900">
                              {entry.rationale}
                            </p>
                            <p className="mt-1 text-xs uppercase tracking-[0.16em] text-rose-700">
                              Source: {entry.evidenceSource}
                            </p>
                            <p className="mt-1 text-xs text-rose-800">
                              Evidence refs: {entry.evidenceRefs.join(", ") || "-"}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="max-h-48 overflow-auto">
                      {activity.file.patch ? (
                        <pre className="whitespace-pre-wrap font-mono text-xs leading-6 text-slate-700">
                          {activity.file.patch}
                        </pre>
                      ) : (
                        <p className="text-sm text-slate-500">No patch text captured.</p>
                      )}
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
                Belum ada histori commit dari exported history yang menyentuh file ini.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
