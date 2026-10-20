"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { PanelIcon } from "@/app/history-viewer/components/PanelIcon";
import { RationaleSections } from "@/app/history-viewer/components/RationaleSections";
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

type ActivityHighlight = {
  activity: RepoActivityEntry;
  ranges: HighlightRange[];
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

function getActivitiesForLine(
  lineNumber: number,
  highlights: ActivityHighlight[],
) {
  return highlights
    .filter((highlight) => isLineHighlighted(lineNumber, highlight.ranges))
    .map((highlight) => highlight.activity);
}

function getActivityTone(activityId: string, activeActivityId: string) {
  return activityId === activeActivityId
    ? "border-amber-400 bg-amber-50 text-amber-900"
    : "border-slate-200 bg-white text-slate-700 hover:border-amber-300 hover:bg-amber-50/60";
}

function sortActivitiesByCommitDate(activities: RepoActivityEntry[]) {
  return [...activities].sort(
    (left, right) =>
      new Date(right.committedAt).getTime() -
      new Date(left.committedAt).getTime(),
  );
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
  const [filesPanelCollapsed, setFilesPanelCollapsed] = useState(false);
  const [historyPanelCollapsed, setHistoryPanelCollapsed] = useState(false);
  const [hoveredActivityId, setHoveredActivityId] = useState("");
  const [pinnedActivityId, setPinnedActivityId] = useState("");
  const [hoveredLineNumber, setHoveredLineNumber] = useState<number | null>(null);
  const [pinnedLineNumber, setPinnedLineNumber] = useState<number | null>(null);
  const [expandedRationaleKeys, setExpandedRationaleKeys] = useState<string[]>(
    [],
  );
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
    () => sortActivitiesByCommitDate(activityMap.get(selectedFilePath) || []),
    [activityMap, selectedFilePath],
  );
  const resolvedSelectedActivityId = selectedActivities.some(
    (entry) => entry.id === selectedActivityId,
  )
    ? selectedActivityId
    : "";
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
        setHoveredActivityId("");
        setPinnedActivityId("");
        setHoveredLineNumber(null);
        setPinnedLineNumber(null);
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
  const activityHighlights = useMemo<ActivityHighlight[]>(() => {
    if (!fileContent) {
      return [];
    }

    return selectedActivities
      .map((activity) => ({
        activity,
        ranges: buildHighlightRanges(fileContent.content, activity.file.patch),
      }))
      .filter((highlight) => highlight.ranges.length > 0);
  }, [fileContent, selectedActivities]);
  const activeInsightActivityId =
    pinnedActivityId || hoveredActivityId || "";
  const activeInsightActivity =
    selectedActivities.find((entry) => entry.id === activeInsightActivityId) ||
    null;
  const activeInsightRationales = activeInsightActivity?.rationales || [];
  const activeTimelineLineNumber = pinnedLineNumber || hoveredLineNumber;
  const activeTimelineActivities = activeTimelineLineNumber
    ? getActivitiesForLine(activeTimelineLineNumber, activityHighlights)
    : activeInsightActivity
      ? [activeInsightActivity]
      : [];

  useEffect(() => {
    if (!focusedLine) {
      return;
    }

    const element = lineRefs.current[focusedLine];
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusedLine]);

  const codeLines = fileContent?.content.split("\n") || [];
  const repoGridClass = filesPanelCollapsed
    ? historyPanelCollapsed
      ? "xl:grid-cols-[48px_minmax(0,1fr)_48px]"
      : "xl:grid-cols-[48px_minmax(0,1fr)_360px]"
    : historyPanelCollapsed
      ? "xl:grid-cols-[280px_minmax(0,1fr)_48px]"
      : "xl:grid-cols-[280px_minmax(0,1fr)_360px]";
  const codeFocused = filesPanelCollapsed && historyPanelCollapsed;

  const toggleRationaleExpansion = (key: string) => {
    setExpandedRationaleKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  };

  const pinActivity = (activity: RepoActivityEntry, lineNumber?: number | null) => {
    setSelectedActivityId(activity.id);
    setPinnedActivityId(activity.id);
    setPinnedLineNumber(lineNumber || null);
  };

  const clearPinnedFocus = () => {
    setPinnedActivityId("");
    setPinnedLineNumber(null);
  };

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
              Browse the current snapshot first. Historical context appears
              only when a highlighted hunk, line marker, or commit is hovered or selected.
            </p>
          </div>
          <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
            {repoFiles.length} repo files
          </div>
        </div>
      </div>

      <div className={`grid gap-0 ${repoGridClass}`}>
        <div className="border-b border-slate-200 bg-slate-50 xl:border-b-0 xl:border-r">
          <div
            className={`flex items-center border-b border-slate-200 py-3 ${filesPanelCollapsed ? "justify-center px-2" : "justify-between px-4"}`}
          >
            {!filesPanelCollapsed ? (
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Snapshot Files
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setFilesPanelCollapsed((value) => !value)}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-lg text-slate-500 hover:bg-slate-200 hover:text-slate-900"
              aria-label={
                filesPanelCollapsed
                  ? "Expand files panel"
                  : "Collapse files panel"
              }
              title={
                filesPanelCollapsed
                  ? "Expand files panel"
                  : "Collapse files panel"
              }
            >
              {filesPanelCollapsed ? "›" : "‹"}
            </button>
          </div>
          {!filesPanelCollapsed ? (
            <div className="max-h-[760px] overflow-y-auto py-2">
              {repoFilesLoading ? (
                <div className="px-4 py-6 text-sm text-slate-500">
                  Loading files...
                </div>
              ) : repoFilesError ? (
                <div className="px-4 py-6 text-sm text-rose-600">
                  {repoFilesError}
                </div>
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
                    {(activeIssueNumber || activeCommitSha) &&
                    repoFileFilterMode !== "all" ? (
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
                    (filename) => {
                      setHoveredActivityId("");
                      setPinnedActivityId("");
                      setHoveredLineNumber(null);
                      setPinnedLineNumber(null);
                      setSelectedFilePath(filename);
                    },
                    () => <PanelIcon name="folder" />,
                    () => <PanelIcon name="file" />,
                  )}
                </>
              )}
            </div>
          ) : null}
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
                {activityHighlights.length > 0 ? (
                  <p className="mt-1 text-xs text-slate-500">
                    {activityHighlights.length} historical hunk marker
                    {activityHighlights.length === 1 ? "" : "s"} available.
                    Hover a highlighted line or click a marker to inspect why it changed.
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const nextFocused = !codeFocused;
                    setFilesPanelCollapsed(nextFocused);
                    setHistoryPanelCollapsed(nextFocused);
                  }}
                  className="grid h-9 w-9 place-items-center rounded-lg text-lg text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                  aria-label={
                    codeFocused ? "Restore side panels" : "Focus code panel"
                  }
                  title={
                    codeFocused ? "Restore side panels" : "Focus code panel"
                  }
                >
                  {codeFocused ? "⊡" : "⛶"}
                </button>
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
                    const lineActivities = getActivitiesForLine(
                      lineNumber,
                      activityHighlights,
                    );
                    const primaryActivity = lineActivities[0] || null;
                    const isFocused = lineActivities.length > 0;
                    const isActive =
                      primaryActivity?.id &&
                      primaryActivity.id === activeInsightActivityId;

                    return (
                      <div
                        key={`${selectedFilePath}-${lineNumber}`}
                        ref={(element) => {
                          lineRefs.current[lineNumber] = element;
                        }}
                        onMouseEnter={() => {
                          if (primaryActivity) {
                            setHoveredActivityId(primaryActivity.id);
                            setHoveredLineNumber(lineNumber);
                          }
                        }}
                        onMouseLeave={() => {
                          setHoveredActivityId("");
                          setHoveredLineNumber(null);
                        }}
                        onClick={() => {
                          if (primaryActivity) {
                            pinActivity(primaryActivity, lineNumber);
                          }
                        }}
                        className={`grid grid-cols-[88px_minmax(0,1fr)] border-b border-slate-100 font-mono text-xs transition-colors ${
                          isActive
                            ? "bg-amber-100"
                            : isFocused
                              ? "bg-amber-50/50"
                              : "bg-white"
                        } ${primaryActivity ? "cursor-pointer" : ""}`}
                      >
                        <div className="flex items-center justify-end gap-2 border-r border-slate-200 px-3 py-1 text-right text-slate-400">
                          {primaryActivity ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (
                                  pinnedActivityId === primaryActivity.id &&
                                  pinnedLineNumber === lineNumber
                                ) {
                                  setPinnedActivityId("");
                                  setPinnedLineNumber(null);
                                  return;
                                }

                                pinActivity(primaryActivity, lineNumber);
                              }}
                              className={`h-2.5 w-2.5 rounded-full border ${
                                isActive
                                  ? "border-amber-600 bg-amber-500"
                                  : "border-amber-500 bg-amber-200 hover:bg-amber-400"
                              }`}
                              aria-label={`Inspect history for line ${lineNumber}`}
                              title={`Inspect ${lineActivities.length} linked change${lineActivities.length === 1 ? "" : "s"}`}
                            />
                          ) : null}
                          <span>{lineNumber}</span>
                        </div>
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
                      snippetRows.map((row, index) => {
                        if (row.kind === "separator") {
                          return (
                          <div
                            key={`separator-${index}`}
                            className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-400"
                          >
                            ...
                          </div>
                          );
                        }

                        const rowActivities = getActivitiesForLine(
                          row.lineNumber,
                          activityHighlights,
                        );
                        const primaryActivity = rowActivities[0] || null;
                        const isActive =
                          primaryActivity?.id &&
                          primaryActivity.id === activeInsightActivityId;

                        return (
                          <div
                            key={`snippet-${row.lineNumber}`}
                            onMouseEnter={() => {
                              if (primaryActivity) {
                                setHoveredActivityId(primaryActivity.id);
                                setHoveredLineNumber(row.lineNumber);
                              }
                            }}
                            onMouseLeave={() => {
                              setHoveredActivityId("");
                              setHoveredLineNumber(null);
                            }}
                            onClick={() => {
                              if (primaryActivity) {
                                pinActivity(primaryActivity, row.lineNumber);
                              }
                            }}
                            className={`grid grid-cols-[72px_minmax(0,1fr)] border-b border-slate-100 font-mono text-xs ${
                              isActive
                                ? "bg-amber-100"
                                : row.isFocused
                                  ? "bg-amber-50"
                                  : "bg-white"
                            } ${primaryActivity ? "cursor-pointer" : ""}`}
                          >
                            <span className="border-r border-slate-200 px-4 py-1 text-right text-slate-400">
                              {row.lineNumber}
                            </span>
                            <pre className="overflow-x-auto px-4 py-1 whitespace-pre-wrap text-slate-700">
                              {row.text || " "}
                            </pre>
                          </div>
                        );
                      })
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
                        <div className="grid grid-cols-2 border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          <div className="border-r border-slate-200 px-4 py-2">Before</div>
                          <div className="px-4 py-2">After</div>
                        </div>
                        {selectedDiffRows.map((row, index) => (
                          <div
                            key={`${selectedActivity.id}-${index}`}
                            onMouseEnter={() =>
                              setHoveredActivityId(selectedActivity.id)
                            }
                            onMouseLeave={() => setHoveredActivityId("")}
                            onClick={() => pinActivity(selectedActivity, null)}
                            className={`grid cursor-pointer grid-cols-2 border-b border-slate-100 font-mono text-xs ${
                              activeInsightActivityId === selectedActivity.id
                                ? "ring-1 ring-inset ring-amber-300"
                                : ""
                            }`}
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
          <div
            className={`flex items-center border-b border-slate-200 py-3 ${historyPanelCollapsed ? "justify-center px-2" : "justify-between px-4"}`}
          >
            <button
              type="button"
              onClick={() => setHistoryPanelCollapsed((value) => !value)}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-lg text-slate-500 hover:bg-slate-200 hover:text-slate-900"
              aria-label={
                historyPanelCollapsed
                  ? "Expand history panel"
                  : "Collapse history panel"
              }
              title={
                historyPanelCollapsed
                  ? "Expand history panel"
                  : "Collapse history panel"
              }
            >
              {historyPanelCollapsed ? "‹" : "›"}
            </button>
            {!historyPanelCollapsed ? (
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                History on this file
              </span>
            ) : null}
          </div>

          {!historyPanelCollapsed ? (
            <div className="max-h-[760px] space-y-3 overflow-y-auto p-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Context Inspector
                  </p>
                  {pinnedActivityId || pinnedLineNumber ? (
                    <button
                      type="button"
                      onClick={clearPinnedFocus}
                      className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Unfocus
                    </button>
                  ) : null}
                </div>
                {activeInsightActivity ? (
                  <div className="mt-3">
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                        PR #{activeInsightActivity.issueNumber}
                      </span>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                        {activeInsightActivity.commitSha.slice(0, 7)}
                      </span>
                    </div>
                    <p className="mt-3 text-sm font-semibold text-slate-950">
                      {activeInsightActivity.commitMessage.split("\n")[0]}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {activeInsightActivity.author} •{" "}
                      {new Date(activeInsightActivity.committedAt).toLocaleString(
                        "id-ID",
                      )}
                    </p>
                    <p className="mt-3 line-clamp-2 text-sm text-slate-600">
                      {activeInsightActivity.issueTitle}
                    </p>
                    {activeTimelineActivities.length > 0 ? (
                      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                          {activeTimelineLineNumber
                            ? `Timeline around line ${activeTimelineLineNumber}`
                            : "Selected change timeline"}
                        </p>
                        <div className="mt-3 space-y-3">
                          {activeTimelineActivities.map((activity, index) => {
                            const isCurrent =
                              activity.id === activeInsightActivity.id;

                            return (
                              <button
                                key={`${activity.id}-timeline`}
                                type="button"
                                onClick={() =>
                                  pinActivity(activity, activeTimelineLineNumber)
                                }
                                className={`grid w-full grid-cols-[20px_minmax(0,1fr)] gap-3 text-left ${
                                  isCurrent
                                    ? "text-amber-900"
                                    : "text-slate-600 hover:text-slate-900"
                                }`}
                              >
                                <span className="relative mt-1 flex justify-center">
                                  <span
                                    className={`h-3 w-3 rounded-full border ${
                                      isCurrent
                                        ? "border-amber-600 bg-amber-500"
                                        : "border-slate-300 bg-white"
                                    }`}
                                  />
                                  {index < activeTimelineActivities.length - 1 ? (
                                    <span className="absolute top-3 h-8 w-px bg-slate-200" />
                                  ) : null}
                                </span>
                                <span className="min-w-0">
                                  <span className="block text-xs font-semibold">
                                    {new Date(activity.committedAt).toLocaleString(
                                      "id-ID",
                                    )}
                                  </span>
                                  <span className="mt-1 block truncate text-xs">
                                    {activity.commitMessage.split("\n")[0]}
                                  </span>
                                  <span className="mt-1 block text-[11px] text-slate-500">
                                    PR #{activity.issueNumber} •{" "}
                                    {activity.commitSha.slice(0, 7)}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                    {activeInsightRationales.length > 0 ? (
                      <div className="mt-4 space-y-3">
                        {activeInsightRationales.map((entry, index) => {
                          const rationaleKey = `${activeInsightActivity.id}-inspector-rationale-${index}`;
                          const isExpanded =
                            expandedRationaleKeys.includes(rationaleKey);

                          return (
                            <div
                              key={rationaleKey}
                              className="rounded-xl border border-rose-200 bg-white"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  toggleRationaleExpansion(rationaleKey)
                                }
                                className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-rose-50"
                              >
                                <span className="min-w-0">
                                  <span className="block text-sm font-semibold text-slate-950">
                                    {entry.change}
                                  </span>
                                  <span className="mt-1 block text-xs text-slate-500">
                                    Rationale details
                                  </span>
                                </span>
                                <span className="shrink-0 text-lg text-slate-400">
                                  {isExpanded ? "-" : "+"}
                                </span>
                              </button>
                              {isExpanded ? (
                                <div className="border-t border-rose-100 bg-rose-50 px-3 py-3">
                                  <RationaleSections
                                    value={entry.rationale}
                                    compact
                                  />
                                  <p className="mt-3 text-xs uppercase tracking-[0.16em] text-rose-700">
                                    Source: {entry.evidenceSource}
                                  </p>
                                  <p className="mt-1 break-words text-xs text-rose-800">
                                    refs: {entry.evidenceRefs.join(", ") || "-"}
                                  </p>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-4 text-sm text-slate-500">
                        This change has no linked rationale in the generated
                        summary artifact.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-slate-500">
                    Hover a highlighted line in the code, click a hunk marker,
                    or choose a commit below to reveal its rationale and patch
                    context.
                  </p>
                )}
              </div>

              {selectedActivities.length > 0 ? (
                <div className="space-y-2">
                  {selectedActivities.map((activity) => (
                    <button
                      key={activity.id}
                      onMouseEnter={() => setHoveredActivityId(activity.id)}
                      onMouseLeave={() => setHoveredActivityId("")}
                      onClick={() => {
                        setSelectedActivityId(activity.id);
                        setPinnedLineNumber(null);
                        setPinnedActivityId((current) =>
                          current === activity.id ? "" : activity.id,
                        );
                      }}
                      className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${getActivityTone(
                        activity.id,
                        activeInsightActivityId,
                      )}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-sm font-semibold">
                          {activity.commitMessage.split("\n")[0]}
                        </span>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                          {activity.commitSha.slice(0, 7)}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>PR #{activity.issueNumber}</span>
                        <span>•</span>
                        <span>{activity.author}</span>
                        {activity.rationales.length > 0 ? (
                          <>
                            <span>•</span>
                            <span>{activity.rationales.length} rationale</span>
                          </>
                        ) : null}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
                  No commit in the exported history changes this file.
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
