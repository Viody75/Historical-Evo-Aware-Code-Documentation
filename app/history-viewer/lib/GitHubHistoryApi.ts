import type {
  Commit,
  CommitDetailsResponse,
  CompareResponse,
  DiscussionComment,
  GitHubDebugStatus,
  HistoricalExportPayload,
  Issue,
  ParsedRepo,
  PullRequestDetailsResponse,
  PullRequestFileResponse,
  SearchIssuesResponse,
  SnapshotRecord,
  SnapshotRepoFileContent,
  SnapshotRepoFileEntry,
  SnapshotSummaryArtifacts,
} from "@/app/history-viewer/types";

export class GitHubHistoryApi {
  constructor(private readonly repoName: string) {}

  static parseRepoUrl(url: string): ParsedRepo {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname !== "github.com") {
      throw new Error("Please enter a valid GitHub URL");
    }

    const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
    if (pathParts.length < 2) {
      throw new Error("Invalid GitHub repo URL");
    }

    return {
      owner: pathParts[0],
      repo: pathParts[1],
    };
  }

  static createProxyUrl(endpoint: string, accept?: string): string {
    const params = new URLSearchParams({
      endpoint,
    });

    if (accept) {
      params.set("accept", accept);
    }

    return `/api/github?${params.toString()}`;
  }

  static endpointFromUrl(githubUrl: string): string {
    const parsed = new URL(githubUrl);
    return `${parsed.pathname}${parsed.search}`;
  }

  static async fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url);
    const contentType = res.headers.get("content-type") || "";
    const rawBody = await res.text();

    let data: unknown = null;

    if (rawBody.trim().length > 0) {
      if (contentType.includes("application/json")) {
        try {
          data = JSON.parse(rawBody);
        } catch {
          throw new Error("Received malformed JSON from GitHub proxy");
        }
      } else {
        data = rawBody;
      }
    }

    if (!res.ok) {
      const message =
        data &&
        typeof data === "object" &&
        "message" in data &&
        typeof data.message === "string"
          ? data.message
          : typeof data === "string" && data.trim().length > 0
            ? data
            : res.statusText || "GitHub API error";
      throw new Error(message);
    }

    if (data === null) {
      throw new Error("GitHub proxy returned an empty response body");
    }

    return data as T;
  }

  static async fetchDebugStatus(): Promise<GitHubDebugStatus> {
    return this.fetchJson<GitHubDebugStatus>("/api/github/debug");
  }

  static async fetchSnapshots(): Promise<SnapshotRecord[]> {
    return this.fetchJson<SnapshotRecord[]>("/api/history-snapshots");
  }

  static async createSnapshot(input: {
    repoName: string;
    branchRef: string;
    payload: HistoricalExportPayload;
  }): Promise<SnapshotRecord> {
    const response = await fetch("/api/history-snapshots", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;
      throw new Error(data?.message || "Failed to create snapshot");
    }

    return (await response.json()) as SnapshotRecord;
  }

  static async fetchSnapshotRepoFiles(
    snapshotId: string,
  ): Promise<SnapshotRepoFileEntry[]> {
    return this.fetchJson<SnapshotRepoFileEntry[]>(
      `/api/history-snapshots/${snapshotId}/repo`,
    );
  }

  static async fetchSnapshotRepoFileContent(
    snapshotId: string,
    filePath: string,
  ): Promise<SnapshotRepoFileContent> {
    return this.fetchJson<SnapshotRepoFileContent>(
      `/api/history-snapshots/${snapshotId}/repo/file?path=${encodeURIComponent(filePath)}`,
    );
  }

  static async fetchSnapshotSummaryArtifacts(snapshotId: string): Promise<
    SnapshotSummaryArtifacts & {
      defaultModel: string;
    }
  > {
    return this.fetchJson<
      SnapshotSummaryArtifacts & {
        defaultModel: string;
      }
    >(`/api/history-snapshots/${snapshotId}/summary`);
  }

  static async generateSnapshotSummaries(input: {
    snapshotId: string;
    apiKey?: string;
    model?: string;
  }): Promise<
    SnapshotSummaryArtifacts & {
      defaultModel: string;
    }
  > {
    const response = await fetch(`/api/history-snapshots/${input.snapshotId}/summary`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        apiKey: input.apiKey,
        model: input.model,
      }),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;
      throw new Error(data?.message || "Failed to generate snapshot summaries");
    }

    return (await response.json()) as SnapshotSummaryArtifacts & {
      defaultModel: string;
    };
  }

  static async fetchIssues(
    owner: string,
    repo: string,
    page: number,
  ): Promise<Issue[]> {
    return this.fetchJson<Issue[]>(
      this.createProxyUrl(
        `/repos/${owner}/${repo}/issues?state=all&sort=created&direction=desc&per_page=5&page=${page}`,
        "application/vnd.github.full+json",
      ),
    );
  }

  static async fetchMergedPullRequestsByDateRange(
    owner: string,
    repo: string,
    page: number,
    dateFrom: string,
    dateTo: string,
  ): Promise<SearchIssuesResponse> {
    const query = [
      `repo:${owner}/${repo}`,
      "is:pr",
      "is:merged",
      `merged:${dateFrom}..${dateTo}`,
    ].join(" ");

    return this.fetchJson<SearchIssuesResponse>(
      this.createProxyUrl(
        `/search/issues?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=5&page=${page}`,
        "application/vnd.github.full+json",
      ),
    );
  }

  fetchCommitDiff(commitSha: string): Promise<CommitDetailsResponse> {
    return GitHubHistoryApi.fetchJson<CommitDetailsResponse>(
      GitHubHistoryApi.createProxyUrl(`/repos/${this.repoName}/commits/${commitSha}`),
    );
  }

  fetchIssueComments(commentsUrl: string): Promise<DiscussionComment[]> {
    return GitHubHistoryApi.fetchJson<DiscussionComment[]>(
      GitHubHistoryApi.createProxyUrl(
        GitHubHistoryApi.endpointFromUrl(`${commentsUrl}?per_page=100`),
        "application/vnd.github.full+json",
      ),
    );
  }

  fetchReviewComments(issueNumber: number): Promise<DiscussionComment[]> {
    return GitHubHistoryApi.fetchJson<DiscussionComment[]>(
      GitHubHistoryApi.createProxyUrl(
        `/repos/${this.repoName}/pulls/${issueNumber}/comments?per_page=100`,
        "application/vnd.github.full+json",
      ),
    );
  }

  fetchPullRequestCommits(issueNumber: number): Promise<Commit[]> {
    return GitHubHistoryApi.fetchJson<Commit[]>(
      GitHubHistoryApi.createProxyUrl(
        `/repos/${this.repoName}/pulls/${issueNumber}/commits?per_page=5`,
      ),
    );
  }

  fetchPullRequestDetails(issueNumber: number): Promise<PullRequestDetailsResponse> {
    return GitHubHistoryApi.fetchJson<PullRequestDetailsResponse>(
      GitHubHistoryApi.createProxyUrl(`/repos/${this.repoName}/pulls/${issueNumber}`),
    );
  }

  fetchPullRequestFiles(issueNumber: number): Promise<PullRequestFileResponse[]> {
    return GitHubHistoryApi.fetchJson<PullRequestFileResponse[]>(
      GitHubHistoryApi.createProxyUrl(
        `/repos/${this.repoName}/pulls/${issueNumber}/files?per_page=100`,
      ),
    );
  }

  compareRefs(baseRef: string, headRef: string): Promise<CompareResponse> {
    return GitHubHistoryApi.fetchJson<CompareResponse>(
      GitHubHistoryApi.createProxyUrl(
        `/repos/${this.repoName}/compare/${encodeURIComponent(baseRef)}...${encodeURIComponent(headRef)}`,
      ),
    );
  }
}
