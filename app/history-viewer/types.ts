export interface Commit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      date: string;
    };
  };
  html_url: string;
}

export interface DiscussionComment {
  id: number;
  user: {
    login: string;
  };
  body: string;
  body_html?: string;
  created_at: string;
  html_url?: string;
}

export interface Issue {
  number: number;
  title: string;
  body: string;
  body_html?: string;
  html_url: string;
  comments_url: string;
  created_at: string;
  pull_request?: {
    url: string;
  };
}

export interface Diff {
  filename: string;
  patch: string;
}

export interface PullRequestInfo {
  baseRef: string;
  headRef: string;
}

export interface PullRequestFile extends Diff {
  status: string;
}

export interface CommitWithDiff extends Commit {
  diffs: Diff[];
}

export interface CommitDetailsResponse {
  files?: Diff[];
}

export interface IssueWithCommits extends Issue {
  commits: CommitWithDiff[];
  comments: DiscussionComment[];
  reviewComments: DiscussionComment[];
  detailsLoaded: boolean;
  prInfo?: PullRequestInfo;
  changedFiles: PullRequestFile[];
}

export interface HistoricalDiscussionEntry {
  id: number;
  type: "issue_comment" | "review_comment";
  author: string;
  createdAt: string;
  url?: string;
  body: string;
}

export interface HistoricalCommitEntry {
  sha: string;
  message: string;
  author: string;
  committedAt: string;
  url: string;
  codeChanges: Diff[];
}

export interface HistoricalIssueEntry {
  issueNumber: number;
  title: string;
  url: string;
  createdAt: string;
  summary: string | null;
  discussion: HistoricalDiscussionEntry[];
  commits: HistoricalCommitEntry[];
}

export interface HistoricalExportPayload {
  repo: string;
  fetchedAt: string;
  exportType: "historical-evolution";
  description: string;
  issues: HistoricalIssueEntry[];
}

export interface GitHubDebugStatus {
  authenticated: boolean;
  envConfigured: boolean;
  rateLimit: {
    limit: number;
    remaining: number;
    used: number;
    resetAt: string;
  };
}

export interface CompareResponse {
  base_commit: {
    sha: string;
  };
  merge_base_commit: {
    sha: string;
  };
  status: string;
  ahead_by: number;
  behind_by: number;
  total_commits: number;
  files?: PullRequestFileResponse[];
}

export interface PullRequestDetailsResponse {
  base: {
    ref: string;
  };
  head: {
    ref: string;
  };
  merged_at?: string | null;
}

export interface PullRequestFileResponse {
  filename: string;
  patch?: string;
  status: string;
}

export interface DiffRow {
  kind: "context" | "delete" | "add";
  beforeLineNumber: number | null;
  afterLineNumber: number | null;
  beforeText: string;
  afterText: string;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: "folder" | "file";
  file?: PullRequestFile;
  children: FileTreeNode[];
}

export interface ParsedRepo {
  owner: string;
  repo: string;
}

export interface SearchIssuesResponse {
  total_count: number;
  incomplete_results: boolean;
  items: Issue[];
}

export interface SnapshotRecord {
  id: string;
  repoName: string;
  requestedBranchRef: string;
  storedBranchRef: string;
  createdAt: string;
  snapshotDir: string;
  historyFile: string;
  repoDir: string;
}

export interface SnapshotRepoFileEntry {
  path: string;
  size: number;
}

export interface SnapshotRepoFileContent {
  path: string;
  content: string;
  isBinary: boolean;
}

export interface SnapshotNavigationTarget {
  issueNumber?: number;
  commitSha?: string;
  filePath?: string;
  label?: string;
}

export type TreeNodeKind =
  | "root"
  | "issues"
  | "issue"
  | "group"
  | "discussion"
  | "commit"
  | "change"
  | "rationale";

export interface HistoryTreeNode {
  id: string;
  label: string;
  kind: TreeNodeKind;
  meta?: string;
  detail?: string;
  target?: SnapshotNavigationTarget;
  children: HistoryTreeNode[];
}

export interface SummaryWhatChangedEntry {
  change: string;
  rationale: string;
  relatedCommitIds: string[];
  evidenceRefs: string[];
  evidenceSource:
    | "discussion"
    | "commit_message"
    | "patch_excerpt"
    | "inferred";
}

export interface GeneratedIssueSummary {
  issueNumber: number;
  title: string;
  relatedIssue: string | null;
  pullRequest: string;
  background: string;
  whatChanged: SummaryWhatChangedEntry[];
  impact: {
    user: string[];
    system: string[];
    developer: string[];
  };
  testingVerification: string[];
  notes: string[];
  markdown: string;
  markdownFile: string;
  generatedAt: string;
  model: string;
}

export interface SnapshotSummaryIndex {
  repo: string;
  generatedAt: string;
  model: string;
  templatePath: string;
  issues: GeneratedIssueSummary[];
}

export interface SnapshotAstArtifact {
  repo: string;
  generatedAt: string;
  tree: HistoryTreeNode;
}

export interface SnapshotSummaryArtifacts {
  index: SnapshotSummaryIndex | null;
  ast: SnapshotAstArtifact | null;
}

export type WorkspaceView = "issue-journey" | "comparator";
