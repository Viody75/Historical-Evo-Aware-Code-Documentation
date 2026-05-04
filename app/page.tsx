"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ComparatorViewer } from "@/app/history-viewer/components/ComparatorViewer";
import { GitHubStatusPanel } from "@/app/history-viewer/components/GitHubStatusPanel";
import { IssueCard } from "@/app/history-viewer/components/IssueCard";
import { PanelIcon } from "@/app/history-viewer/components/PanelIcon";
import { SidebarNav } from "@/app/history-viewer/components/SidebarNav";
import { GitHubHistoryApi } from "@/app/history-viewer/lib/GitHubHistoryApi";
import type {
  Commit,
  CommitWithDiff,
  DiscussionComment,
  HistoricalExportPayload,
  HistoricalIssueEntry,
  Issue,
  IssueWithCommits,
  PullRequestFile,
  SnapshotRecord,
  WorkspaceView,
} from "@/app/history-viewer/types";

function createInitialIssue(issue: Issue): IssueWithCommits {
  return {
    ...issue,
    comments: [],
    reviewComments: [],
    commits: [],
    detailsLoaded: false,
    changedFiles: [],
  };
}

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

export default function Home() {
  const todayDate = getTodayDateString();
  const [url, setUrl] = useState("");
  const [repoName, setRepoName] = useState("");
  const [issuesWithCommits, setIssuesWithCommits] = useState<
    IssueWithCommits[]
  >([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [journeyAutomationLoading, setJourneyAutomationLoading] =
    useState(false);
  const [journeyAutomationStatus, setJourneyAutomationStatus] = useState("");
  const [maxAutoLoadMoreIssues, setMaxAutoLoadMoreIssues] = useState(3);
  const [automationMergedOnly, setAutomationMergedOnly] = useState(false);
  const [automationDateFrom, setAutomationDateFrom] = useState(todayDate);
  const [automationDateTo, setAutomationDateTo] = useState(todayDate);
  const [storedSnapshots, setStoredSnapshots] = useState<SnapshotRecord[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [snapshotsError, setSnapshotsError] = useState("");
  const [debugStatus, setDebugStatus] = useState<Awaited<
    ReturnType<typeof GitHubHistoryApi.fetchDebugStatus>
  > | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugError, setDebugError] = useState("");
  const [issuePage, setIssuePage] = useState(1);
  const [hasMoreIssues, setHasMoreIssues] = useState(true);
  const [loadingIssueIds, setLoadingIssueIds] = useState<Set<number>>(
    new Set(),
  );
  const [loadingCommitShas, setLoadingCommitShas] = useState<Set<string>>(
    new Set(),
  );
  const [expandedIssues, setExpandedIssues] = useState<Set<number>>(new Set());
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(
    new Set(),
  );
  const [expandedIssueComments, setExpandedIssueComments] = useState<
    Set<number>
  >(new Set());
  const [expandedIssueReviews, setExpandedIssueReviews] = useState<Set<number>>(
    new Set(),
  );
  const [expandedCommitMessages, setExpandedCommitMessages] = useState<
    Set<string>
  >(new Set());
  const [expandedDiffs, setExpandedDiffs] = useState<Set<string>>(new Set());
  const [selectedComparatorFiles, setSelectedComparatorFiles] = useState<
    Record<number, string>
  >({});
  const [activeView, setActiveView] = useState<WorkspaceView>("issue-journey");
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [manualComparatorBase, setManualComparatorBase] = useState("master");
  const [manualComparatorHead, setManualComparatorHead] = useState("");
  const [manualComparatorLoading, setManualComparatorLoading] = useState(false);
  const [manualComparatorError, setManualComparatorError] = useState("");
  const [manualComparatorFiles, setManualComparatorFiles] = useState<
    PullRequestFile[]
  >([]);
  const [manualComparatorSummary, setManualComparatorSummary] = useState<{
    baseRef: string;
    headRef: string;
    status: string;
    aheadBy: number;
    behindBy: number;
    totalCommits: number;
  } | null>(null);
  const [manualComparatorSelectedFile, setManualComparatorSelectedFile] =
    useState("");

  const repoApi = repoName ? new GitHubHistoryApi(repoName) : null;

  const getIssueDiscussionLabel = (issue: IssueWithCommits) => {
    if (loadingIssueIds.has(issue.number)) {
      return "Loading discussion details...";
    }

    if (journeyAutomationLoading && !issue.detailsLoaded) {
      return "Automation loading discussion details...";
    }

    if (exportLoading && !issue.detailsLoaded) {
      return "Preparing export details...";
    }

    if (!issue.detailsLoaded) {
      return "Discussion details not loaded yet";
    }

    return `${issue.comments.length + issue.reviewComments.length} discussion items`;
  };

  const updateIssueByNumber = (
    issueNumber: number,
    updater: (issue: IssueWithCommits) => IssueWithCommits,
  ) => {
    setIssuesWithCommits((prev) =>
      prev.map((issue) =>
        issue.number === issueNumber ? updater(issue) : issue,
      ),
    );
  };

  const toggleNumberInSet = (
    setter: React.Dispatch<React.SetStateAction<Set<number>>>,
    value: number,
  ) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  };

  const toggleStringInSet = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    value: string,
  ) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  };

  const selectComparatorFile = (issueNumber: number, filename: string) => {
    setSelectedComparatorFiles((prev) => ({
      ...prev,
      [issueNumber]: filename,
    }));
  };

  const loadCommitDiff = async (commitSha: string) => {
    if (!repoApi) {
      return null;
    }

    const issue = issuesWithCommits.find((item) =>
      item.commits.some((commit) => commit.sha === commitSha),
    );
    const commit = issue?.commits.find((item) => item.sha === commitSha);

    if (
      !commit ||
      commit.diffs.length > 0 ||
      loadingCommitShas.has(commitSha)
    ) {
      return commit ?? null;
    }

    setLoadingCommitShas((prev) => new Set(prev).add(commitSha));

    try {
      const diffData = await repoApi.fetchCommitDiff(commitSha);
      const diffs =
        diffData.files?.map((file) => ({
          filename: file.filename,
          patch: file.patch || "",
        })) || [];

      setIssuesWithCommits((prev) =>
        prev.map((issueItem) => ({
          ...issueItem,
          commits: issueItem.commits.map((commitItem) =>
            commitItem.sha === commitSha
              ? { ...commitItem, diffs }
              : commitItem,
          ),
        })),
      );

      return { ...commit, diffs };
    } catch (error) {
      console.error(`Error fetching diff for commit ${commitSha}:`, error);
      alert(
        error instanceof Error
          ? `Error loading diff for commit ${commitSha}: ${error.message}`
          : "Error loading commit diff",
      );
      return commit;
    } finally {
      setLoadingCommitShas((prev) => {
        const next = new Set(prev);
        next.delete(commitSha);
        return next;
      });
    }
  };

  const fetchIssueDetails = async (
    issueNumber: number,
  ): Promise<IssueWithCommits | null | undefined> => {
    if (!repoApi) {
      return null;
    }

    const issue = issuesWithCommits.find((item) => item.number === issueNumber);
    if (!issue || issue.detailsLoaded || loadingIssueIds.has(issueNumber)) {
      return issue;
    }

    setLoadingIssueIds((prev) => new Set(prev).add(issueNumber));

    try {
      const [
        comments,
        reviewComments,
        prCommitsData,
        pullRequest,
        pullRequestFiles,
      ] = await Promise.all([
        repoApi.fetchIssueComments(issue.comments_url),
        issue.pull_request
          ? repoApi.fetchReviewComments(issue.number)
          : Promise.resolve([] as DiscussionComment[]),
        repoApi.fetchPullRequestCommits(issue.number),
        repoApi.fetchPullRequestDetails(issue.number),
        repoApi.fetchPullRequestFiles(issue.number),
      ]);

      const commits: CommitWithDiff[] = Array.isArray(prCommitsData)
        ? prCommitsData.map((commit: Commit) => ({
            ...commit,
            diffs: [],
          }))
        : [];

      const changedFiles = pullRequestFiles.map((file) => ({
        filename: file.filename,
        patch: file.patch || "",
        status: file.status,
      }));

      const nextIssue: IssueWithCommits = {
        ...issue,
        comments,
        reviewComments,
        commits,
        detailsLoaded: true,
        prInfo: {
          baseRef: pullRequest.base.ref,
          headRef: pullRequest.head.ref,
        },
        changedFiles,
      };

      updateIssueByNumber(issueNumber, () => nextIssue);
      setSelectedComparatorFiles((prev) =>
        prev[issueNumber] || changedFiles.length === 0
          ? prev
          : { ...prev, [issueNumber]: changedFiles[0].filename },
      );

      return nextIssue;
    } catch (error) {
      console.error(`Error fetching details for issue ${issueNumber}:`, error);
      alert(
        error instanceof Error
          ? `Error loading issue details: ${error.message}`
          : "Error loading issue details",
      );
      return issue;
    } finally {
      setLoadingIssueIds((prev) => {
        const next = new Set(prev);
        next.delete(issueNumber);
        return next;
      });
    }
  };

  const isIssueWithinAutomationDateRange = (issue: Issue) => {
    if (!automationDateFrom && !automationDateTo) {
      return true;
    }

    const issueTime = new Date(issue.created_at).getTime();
    const fromTime = automationDateFrom
      ? new Date(`${automationDateFrom}T00:00:00`).getTime()
      : Number.NEGATIVE_INFINITY;
    const toTime = automationDateTo
      ? new Date(`${automationDateTo}T23:59:59.999`).getTime()
      : Number.POSITIVE_INFINITY;

    return issueTime >= fromTime && issueTime <= toTime;
  };

  const fetchIssuePageData = async (page: number) => {
    const { owner, repo } = GitHubHistoryApi.parseRepoUrl(url);
    const issuesData = await GitHubHistoryApi.fetchIssues(owner, repo, page);
    const repoLabel = `${owner}/${repo}`;
    const pageApi = new GitHubHistoryApi(repoLabel);
    const pullRequestIssues = issuesData
      .filter((issue) => issue.pull_request)
      .filter(isIssueWithinAutomationDateRange);

    const filteredIssues = automationMergedOnly
      ? (
          await Promise.all(
            pullRequestIssues.map(async (issue) => {
              const details = await pageApi.fetchPullRequestDetails(
                issue.number,
              );
              return details.merged_at ? issue : null;
            }),
          )
        ).filter((issue): issue is Issue => issue !== null)
      : pullRequestIssues;

    return {
      repoLabel,
      issues: filteredIssues.map(createInitialIssue),
      hasMore: issuesData.length === 5,
      page,
    };
  };

  const loadIssues = async (page: number, reset = false) => {
    setIssuesLoading(true);

    try {
      const pageData = await fetchIssuePageData(page);

      setIssuesWithCommits((prev) =>
        reset ? pageData.issues : [...prev, ...pageData.issues],
      );
      setIssuePage(pageData.page);
      setHasMoreIssues(pageData.hasMore);
      setRepoName(pageData.repoLabel);
    } catch (error) {
      console.error("Error loading issues:", error);
      alert(
        error instanceof Error
          ? error.message
          : "Error loading issues. Please try again.",
      );
    } finally {
      setIssuesLoading(false);
    }
  };

  const loadDebugStatus = async () => {
    setDebugLoading(true);
    setDebugError("");

    try {
      const status = await GitHubHistoryApi.fetchDebugStatus();
      setDebugStatus(status);
    } catch (error) {
      setDebugError(
        error instanceof Error
          ? error.message
          : "Failed to load GitHub authentication status",
      );
    } finally {
      setDebugLoading(false);
    }
  };

  const loadSnapshots = async () => {
    setSnapshotsLoading(true);
    setSnapshotsError("");

    try {
      const snapshots = await GitHubHistoryApi.fetchSnapshots();
      setStoredSnapshots(snapshots);
    } catch (error) {
      setSnapshotsError(
        error instanceof Error
          ? error.message
          : "Failed to load saved snapshots",
      );
    } finally {
      setSnapshotsLoading(false);
    }
  };

  const fetchData = async () => {
    if (!url) {
      return;
    }

    setIssuePage(1);
    setHasMoreIssues(true);
    setIssuesWithCommits([]);
    await loadIssues(1, true);
  };

  const loadMoreIssues = async () => {
    await loadIssues(issuePage + 1, false);
  };

  const handleIssueToggle = async (issueNumber: number) => {
    if (!expandedIssues.has(issueNumber)) {
      await fetchIssueDetails(issueNumber);
    }
    toggleNumberInSet(setExpandedIssues, issueNumber);
  };

  const toggleCommit = async (commitSha: string) => {
    if (!expandedCommits.has(commitSha)) {
      await loadCommitDiff(commitSha);
    }
    toggleStringInSet(setExpandedCommits, commitSha);
  };

  const runManualComparator = async () => {
    if (!repoApi) {
      setManualComparatorError("Fetch repository data dulu sebelum compare.");
      return;
    }

    if (!manualComparatorBase.trim() || !manualComparatorHead.trim()) {
      setManualComparatorError("Base dan head ref wajib diisi.");
      return;
    }

    setManualComparatorLoading(true);
    setManualComparatorError("");

    try {
      const compareData = await repoApi.compareRefs(
        manualComparatorBase.trim(),
        manualComparatorHead.trim(),
      );

      const files = (compareData.files || []).map((file) => ({
        filename: file.filename,
        patch: file.patch || "",
        status: file.status,
      }));

      setManualComparatorFiles(files);
      setManualComparatorSelectedFile(files[0]?.filename || "");
      setManualComparatorSummary({
        baseRef: manualComparatorBase.trim(),
        headRef: manualComparatorHead.trim(),
        status: compareData.status,
        aheadBy: compareData.ahead_by,
        behindBy: compareData.behind_by,
        totalCommits: compareData.total_commits,
      });
    } catch (error) {
      setManualComparatorFiles([]);
      setManualComparatorSelectedFile("");
      setManualComparatorSummary(null);
      setManualComparatorError(
        error instanceof Error
          ? error.message
          : "Failed to compare the selected refs.",
      );
    } finally {
      setManualComparatorLoading(false);
    }
  };

  const hydrateIssueForExport = async (
    issue: IssueWithCommits,
    api: GitHubHistoryApi,
  ): Promise<IssueWithCommits> => {
    if (issue.detailsLoaded) {
      return issue;
    }

    const [
      comments,
      reviewComments,
      prCommitsData,
      pullRequest,
      pullRequestFiles,
    ] = await Promise.all([
      api.fetchIssueComments(issue.comments_url),
      issue.pull_request
        ? api.fetchReviewComments(issue.number)
        : Promise.resolve([] as DiscussionComment[]),
      api.fetchPullRequestCommits(issue.number),
      api.fetchPullRequestDetails(issue.number),
      api.fetchPullRequestFiles(issue.number),
    ]);

    const hydratedIssue = {
      ...issue,
      comments,
      reviewComments,
      commits: prCommitsData.map((commit: Commit) => ({
        ...commit,
        diffs: [],
      })),
      detailsLoaded: true,
      prInfo: {
        baseRef: pullRequest.base.ref,
        headRef: pullRequest.head.ref,
      },
      changedFiles: pullRequestFiles.map((file) => ({
        filename: file.filename,
        patch: file.patch || "",
        status: file.status,
      })),
    };

    updateIssueByNumber(issue.number, () => hydratedIssue);

    return hydratedIssue;
  };

  const buildHistoricalIssueFromSource = async (
    issue: IssueWithCommits,
    api: GitHubHistoryApi,
  ): Promise<HistoricalIssueEntry | null> => {
    const issueWithDetails = await hydrateIssueForExport(issue, api);

    if (issueWithDetails.commits.length === 0) {
      return null;
    }

    const commits = await Promise.all(
      issueWithDetails.commits.map(async (commit) => {
        const commitWithDiffs =
          commit.diffs.length > 0
            ? commit
            : (() =>
                api.fetchCommitDiff(commit.sha).then((diffData) => ({
                  ...commit,
                  diffs:
                    diffData.files?.map((file) => ({
                      filename: file.filename,
                      patch: file.patch || "",
                    })) || [],
                })))();

        return {
          sha: commit.sha,
          message: commit.commit.message,
          author: commit.commit.author.name,
          committedAt: commit.commit.author.date,
          url: commit.html_url,
          codeChanges: (await commitWithDiffs).diffs,
        };
      }),
    );

    const discussion = [
      ...issueWithDetails.comments.map((comment) => ({
        id: comment.id,
        type: "issue_comment" as const,
        author: comment.user.login,
        createdAt: comment.created_at,
        url: comment.html_url,
        body: comment.body,
      })),
      ...issueWithDetails.reviewComments.map((comment) => ({
        id: comment.id,
        type: "review_comment" as const,
        author: comment.user.login,
        createdAt: comment.created_at,
        url: comment.html_url,
        body: comment.body,
      })),
    ].sort(
      (left, right) =>
        new Date(left.createdAt).getTime() -
        new Date(right.createdAt).getTime(),
    );

    return {
      issueNumber: issueWithDetails.number,
      title: issueWithDetails.title,
      url: issueWithDetails.html_url,
      createdAt: issueWithDetails.created_at,
      summary: issueWithDetails.body,
      discussion,
      commits,
    };
  };

  const downloadHistoricalJson = async (
    sourceIssues: IssueWithCommits[] = issuesWithCommits,
    sourceRepoName: string = repoName,
    options?: {
      onStatusChange?: (message: string) => void;
    },
  ): Promise<HistoricalExportPayload | null> => {
    if (sourceIssues.length === 0 || !sourceRepoName) {
      return null;
    }

    setExportLoading(true);

    try {
      const exportApi = new GitHubHistoryApi(sourceRepoName);
      const issues: HistoricalIssueEntry[] = [];

      for (const [index, issue] of sourceIssues.entries()) {
        options?.onStatusChange?.(
          `Collecting discussion and code history for PR #${issue.number} (${index + 1}/${sourceIssues.length})...`,
        );

        const historicalIssue = await buildHistoricalIssueFromSource(
          issue,
          exportApi,
        );
        if (historicalIssue) {
          issues.push(historicalIssue);
        }
      }

      options?.onStatusChange?.("Generating final history JSON file...");

      const payload: HistoricalExportPayload = {
        repo: sourceRepoName,
        fetchedAt: new Date().toISOString(),
        exportType: "historical-evolution",
        description:
          "Trimmed repository history focused on linked discussions, commits, and code changes.",
        issues,
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const fileUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = fileUrl;
      link.download = `${sourceRepoName.replace("/", "-") || "github-data"}-history.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(fileUrl);
      options?.onStatusChange?.("History JSON downloaded.");
      return payload;
    } catch (error) {
      console.error("Error building historical export:", error);
      alert(
        error instanceof Error
          ? `Error creating historical export: ${error.message}`
          : "Error creating historical export",
      );
      return null;
    } finally {
      setExportLoading(false);
    }
  };

  const runJourneyAutomation = async () => {
    if (!url) {
      return;
    }

    setJourneyAutomationLoading(true);
    setJourneyAutomationStatus("Preparing automation...");

    try {
      const maxAdditionalLoads = Math.max(0, Math.floor(maxAutoLoadMoreIssues));
      const totalPagesToLoad = 1 + maxAdditionalLoads;
      const aggregatedIssues: IssueWithCommits[] = [];
      let latestRepoLabel = "";
      let lastHasMore = true;
      let lastLoadedPage = 1;

      for (let page = 1; page <= totalPagesToLoad; page += 1) {
        setJourneyAutomationStatus(
          `Fetching issue page ${page} of up to ${totalPagesToLoad}...`,
        );
        const pageData = await fetchIssuePageData(page);
        aggregatedIssues.push(...pageData.issues);
        latestRepoLabel = pageData.repoLabel;
        lastHasMore = pageData.hasMore;
        lastLoadedPage = pageData.page;
        setIssuesWithCommits([...aggregatedIssues]);
        setIssuePage(pageData.page);
        setHasMoreIssues(pageData.hasMore);
        setRepoName(pageData.repoLabel);

        if (!pageData.hasMore) {
          break;
        }
      }

      setIssuePage(lastLoadedPage);
      setHasMoreIssues(lastHasMore);
      setRepoName(latestRepoLabel);
      setIssuesWithCommits(aggregatedIssues);
      const payload = await downloadHistoricalJson(
        aggregatedIssues,
        latestRepoLabel,
        {
          onStatusChange: setJourneyAutomationStatus,
        },
      );

      if (payload && latestRepoLabel) {
        setJourneyAutomationStatus(
          "Saving workspace snapshot with history JSON and latest repository clone...",
        );
        await GitHubHistoryApi.createSnapshot({
          repoName: latestRepoLabel,
          branchRef: "master",
          payload,
        });
        await loadSnapshots();
      }

      setJourneyAutomationStatus("Automation complete.");
    } catch (error) {
      console.error("Error running issue journey automation:", error);
      setJourneyAutomationStatus("Automation failed.");
      alert(
        error instanceof Error
          ? error.message
          : "Error running issue journey automation.",
      );
    } finally {
      setJourneyAutomationLoading(false);
    }
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadDebugStatus();
      void loadSnapshots();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  const selectedManualComparatorFile = manualComparatorFiles.find(
    (file) =>
      file.filename === manualComparatorSelectedFile ||
      (!manualComparatorSelectedFile &&
        manualComparatorFiles[0] &&
        file.filename === manualComparatorFiles[0].filename),
  );

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col lg:flex-row">
        {!sidebarHidden && (
          <SidebarNav
            activeView={activeView}
            onChangeView={setActiveView}
            onHide={() => setSidebarHidden(true)}
          />
        )}

        <main
          className={`flex-1 p-4 md:p-6 lg:p-8 ${sidebarHidden ? "w-full" : ""}`}
        >
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Repository Intelligence
                </p>
                <h1 className="mt-2 text-2xl font-semibold text-slate-950">
                  GitHub Repo History Viewer
                </h1>
                <p className="mt-2 text-sm text-slate-600">
                  Kumpulkan konteks perubahan supaya programmer baru bisa
                  memahami keputusan yang diambil secara historikal, Ide-nya
                  adalah supaya programmer tidak melakukan trial and error dan
                  kesalahan yang sudah pernah dilakukan berdasarkan data
                  historikal repository.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {sidebarHidden && (
                  <button
                    onClick={() => setSidebarHidden(false)}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-200 px-4 py-3 text-sm font-medium text-slate-900 hover:bg-slate-300"
                  >
                    <PanelIcon name="sidebar" />
                    Show sidebar
                  </button>
                )}
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  {repoName
                    ? `Active repository: ${repoName}`
                    : "Belum ada repository yang dimuat"}
                </div>
              </div>
            </div>

            <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <GitHubStatusPanel
                debugStatus={debugStatus}
                debugError={debugError}
                debugLoading={debugLoading}
                onRefresh={loadDebugStatus}
              />

              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <input
                  type="text"
                  placeholder="GitHub Repo URL (e.g., https://github.com/excalidraw/excalidraw)"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                />
                <div className="flex gap-2">
                  <button
                    onClick={fetchData}
                    disabled={issuesLoading}
                    className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {issuesLoading ? "Loading..." : "Fetch Data"}
                  </button>
                  <button
                    onClick={() => {
                      void downloadHistoricalJson();
                    }}
                    disabled={issuesWithCommits.length === 0 || exportLoading}
                    className="rounded-xl bg-slate-200 px-4 py-3 text-sm font-medium text-slate-900 hover:bg-slate-300 disabled:opacity-50"
                  >
                    {exportLoading
                      ? "Building history JSON..."
                      : "Download History JSON"}
                  </button>
                </div>
              </div>
            </div>

            {activeView === "issue-journey" ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Issue Journey Automation
                      </p>
                      <h3 className="mt-1 text-xl font-semibold text-slate-950">
                        Auto fetch and download history
                      </h3>
                      <p className="mt-2 text-sm text-slate-600">
                        Muat beberapa page issue/PR terbaru secara otomatis,
                        lalu langsung proses history JSON tanpa klik manual satu
                        per satu.
                      </p>
                    </div>
                    <div className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700">
                      Latest-first
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-2 md:items-end">
                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-slate-700">
                          Max load more issues
                        </span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={maxAutoLoadMoreIssues}
                          onChange={(event) =>
                            setMaxAutoLoadMoreIssues(
                              Number(event.target.value) || 0,
                            )
                          }
                          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
                        />
                      </label>

                      <label className="flex items-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900">
                        <input
                          type="checkbox"
                          checked={automationMergedOnly}
                          onChange={(event) =>
                            setAutomationMergedOnly(event.target.checked)
                          }
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        <span>Only merged PR</span>
                      </label>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-slate-700">
                          Date from
                        </span>
                        <input
                          type="date"
                          value={automationDateFrom}
                          onChange={(event) =>
                            setAutomationDateFrom(event.target.value)
                          }
                          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-slate-700">
                          Date to
                        </span>
                        <input
                          type="date"
                          value={automationDateTo}
                          onChange={(event) =>
                            setAutomationDateTo(event.target.value)
                          }
                          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
                        />
                      </label>
                    </div>

                    <div>
                      <button
                        onClick={runJourneyAutomation}
                        disabled={
                          journeyAutomationLoading ||
                          exportLoading ||
                          issuesLoading
                        }
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        <PanelIcon name="git" />
                        {journeyAutomationLoading
                          ? "Running automation..."
                          : "Auto Fetch & Download History"}
                      </button>
                    </div>
                  </div>

                  {journeyAutomationStatus && (
                    <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                      {journeyAutomationStatus}
                    </div>
                  )}

                  <p className="mt-3 text-xs text-slate-500">
                    Nilai `0` berarti hanya fetch page pertama. Nilai `3`
                    berarti fetch page pertama lalu maksimal 3 kali `load more`.
                    Date range memakai `created_at` PR, dan default tanggalnya
                    hari ini.
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Snapshot Storage
                      </p>
                      <h3 className="mt-1 text-xl font-semibold text-slate-950">
                        Manage saved history workspaces
                      </h3>
                      <p className="mt-2 text-sm text-slate-600">
                        Automation akan menyimpan satu folder snapshot di
                        project ini berisi `history.json` dan clone repo branch
                        terbaru untuk analisis kode lokal.
                      </p>
                    </div>
                    <button
                      onClick={loadSnapshots}
                      disabled={snapshotsLoading}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-200 px-4 py-3 text-sm font-medium text-slate-900 hover:bg-slate-300 disabled:opacity-50"
                    >
                      <PanelIcon name="folder" />
                      {snapshotsLoading ? "Refreshing..." : "Refresh snapshots"}
                    </button>
                  </div>

                  <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-600">
                    Storage root: `storage/history-snapshots`
                  </div>

                  {snapshotsError && (
                    <p className="mt-3 text-sm text-rose-600">
                      {snapshotsError}
                    </p>
                  )}

                  {storedSnapshots.length > 0 ? (
                    <div className="mt-4 space-y-3">
                      {storedSnapshots.map((snapshot) => (
                        <div
                          key={snapshot.id}
                          className="rounded-2xl border border-slate-200 bg-white p-4"
                        >
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="inline-flex items-center gap-2 rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700">
                                  <PanelIcon name="git" />
                                  {snapshot.repoName}
                                </span>
                                <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700">
                                  requested {snapshot.requestedBranchRef}
                                </span>
                                <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700">
                                  stored {snapshot.storedBranchRef}
                                </span>
                              </div>
                              <p className="mt-3 text-sm text-slate-600">
                                Created{" "}
                                {new Date(snapshot.createdAt).toLocaleString(
                                  "id-ID",
                                )}
                              </p>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                              {snapshot.id}
                            </div>
                          </div>

                          <div className="mt-4 grid gap-3 lg:grid-cols-3">
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                                Snapshot Directory
                              </p>
                              <p className="mt-2 break-all text-sm text-slate-700">
                                {snapshot.snapshotDir}
                              </p>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                                History JSON
                              </p>
                              <p className="mt-2 break-all text-sm text-slate-700">
                                {snapshot.historyFile}
                              </p>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                                Repo Clone
                              </p>
                              <p className="mt-2 break-all text-sm text-slate-700">
                                {snapshot.repoDir}
                              </p>
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            <Link
                              href={`/history-snapshots/${snapshot.id}`}
                              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
                            >
                              <PanelIcon name="file" />
                              Open detail viewer
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
                      Belum ada snapshot tersimpan. Jalankan automation untuk
                      membuat workspace history pertama.
                    </div>
                  )}
                </div>

                {issuesWithCommits.map((issue) => (
                  <IssueCard
                    key={issue.number}
                    issue={issue}
                    isExpanded={expandedIssues.has(issue.number)}
                    isCommentsExpanded={expandedIssueComments.has(issue.number)}
                    isReviewsExpanded={expandedIssueReviews.has(issue.number)}
                    expandedCommits={expandedCommits}
                    expandedCommitMessages={expandedCommitMessages}
                    expandedDiffs={expandedDiffs}
                    loadingCommitShas={loadingCommitShas}
                    discussionLabel={getIssueDiscussionLabel(issue)}
                    selectedComparatorFile={
                      selectedComparatorFiles[issue.number]
                    }
                    onToggleIssue={handleIssueToggle}
                    onToggleIssueComments={(issueNumber) =>
                      toggleNumberInSet(setExpandedIssueComments, issueNumber)
                    }
                    onToggleIssueReviews={(issueNumber) =>
                      toggleNumberInSet(setExpandedIssueReviews, issueNumber)
                    }
                    onToggleCommit={toggleCommit}
                    onToggleFullMessage={(commitSha) =>
                      toggleStringInSet(setExpandedCommitMessages, commitSha)
                    }
                    onToggleFullDiff={(commitSha) =>
                      toggleStringInSet(setExpandedDiffs, commitSha)
                    }
                    onSelectComparatorFile={selectComparatorFile}
                  />
                ))}

                {hasMoreIssues && (
                  <div className="mt-4 flex justify-center">
                    <button
                      onClick={loadMoreIssues}
                      disabled={issuesLoading}
                      className="rounded-xl bg-slate-200 px-4 py-2 text-slate-900 hover:bg-slate-300 disabled:opacity-50"
                    >
                      {issuesLoading
                        ? "Loading more issues..."
                        : "Load more issues"}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Flexible Comparator
                    </p>
                    <h3 className="mt-1 text-xl font-semibold text-slate-950">
                      Compare branch or commit freely
                    </h3>
                    <p className="mt-2 text-sm text-slate-600">
                      Bandingkan ref apa pun dalam repo aktif, misalnya
                      `feature-x` ke `master`, atau commit SHA ke commit SHA
                      lain.
                    </p>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <input
                      type="text"
                      value={manualComparatorBase}
                      onChange={(event) =>
                        setManualComparatorBase(event.target.value)
                      }
                      placeholder="Base ref: master"
                      className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                    />
                    <input
                      type="text"
                      value={manualComparatorHead}
                      onChange={(event) =>
                        setManualComparatorHead(event.target.value)
                      }
                      placeholder="Head ref: feature-branch or commit SHA"
                      className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                    />
                    <button
                      onClick={runManualComparator}
                      disabled={manualComparatorLoading || !repoName}
                      className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {manualComparatorLoading ? "Comparing..." : "Run Compare"}
                    </button>
                  </div>

                  {!repoName && (
                    <p className="mt-3 text-sm text-amber-700">
                      Repository belum aktif. Fetch repo dulu dari URL GitHub di
                      atas.
                    </p>
                  )}

                  {manualComparatorError && (
                    <p className="mt-3 text-sm text-rose-600">
                      {manualComparatorError}
                    </p>
                  )}

                  {manualComparatorSummary && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700">
                        {manualComparatorSummary.headRef} to{" "}
                        {manualComparatorSummary.baseRef}
                      </span>
                      <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700">
                        status: {manualComparatorSummary.status}
                      </span>
                      <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700">
                        ahead {manualComparatorSummary.aheadBy}
                      </span>
                      <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700">
                        behind {manualComparatorSummary.behindBy}
                      </span>
                      <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700">
                        commits {manualComparatorSummary.totalCommits}
                      </span>
                    </div>
                  )}
                </div>

                {manualComparatorSummary && manualComparatorFiles.length > 0 ? (
                  <ComparatorViewer
                    title={`${manualComparatorSummary.headRef} to ${manualComparatorSummary.baseRef}`}
                    subtitle="Viewer compare yang lebih fleksibel dari PR Comparator di Issue Journey."
                    files={manualComparatorFiles}
                    selectedFile={selectedManualComparatorFile}
                    onSelectFile={setManualComparatorSelectedFile}
                    badge={`${manualComparatorFiles.length} changed files`}
                  />
                ) : manualComparatorSummary ? (
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
                    Compare selesai, tapi tidak ada file perubahan yang bisa
                    ditampilkan.
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
