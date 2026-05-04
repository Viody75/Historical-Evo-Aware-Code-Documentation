import { ComparatorViewer } from "@/app/history-viewer/components/ComparatorViewer";
import { MarkdownBody } from "@/app/history-viewer/components/MarkdownBody";
import { DiffParser } from "@/app/history-viewer/lib/comparator";
import type { IssueWithCommits } from "@/app/history-viewer/types";

export function IssueCard({
  issue,
  isExpanded,
  isCommentsExpanded,
  isReviewsExpanded,
  expandedCommits,
  expandedCommitMessages,
  expandedDiffs,
  loadingCommitShas,
  discussionLabel,
  selectedComparatorFile,
  onToggleIssue,
  onToggleIssueComments,
  onToggleIssueReviews,
  onToggleCommit,
  onToggleFullMessage,
  onToggleFullDiff,
  onSelectComparatorFile,
}: {
  issue: IssueWithCommits;
  isExpanded: boolean;
  isCommentsExpanded: boolean;
  isReviewsExpanded: boolean;
  expandedCommits: Set<string>;
  expandedCommitMessages: Set<string>;
  expandedDiffs: Set<string>;
  loadingCommitShas: Set<string>;
  discussionLabel: string;
  selectedComparatorFile?: string;
  onToggleIssue: (issueNumber: number) => void | Promise<void>;
  onToggleIssueComments: (issueNumber: number) => void;
  onToggleIssueReviews: (issueNumber: number) => void;
  onToggleCommit: (commitSha: string) => void | Promise<void>;
  onToggleFullMessage: (commitSha: string) => void;
  onToggleFullDiff: (commitSha: string) => void;
  onSelectComparatorFile: (issueNumber: number, filename: string) => void;
}) {
  const selectedFile = issue.changedFiles.find(
    (file) =>
      file.filename === selectedComparatorFile ||
      (!selectedComparatorFile &&
        issue.changedFiles[0] &&
        file.filename === issue.changedFiles[0].filename),
  );

  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <div
        className="flex cursor-pointer items-center justify-between gap-4"
        onClick={() => onToggleIssue(issue.number)}
      >
        <div className="flex items-center gap-3">
          <span>{isExpanded ? "▼" : "▶"}</span>
          <div>
            <h3 className="text-lg font-semibold">
              <a
                href={issue.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500"
              >
                #{issue.number} {issue.title}
              </a>
            </h3>
            <p className="text-sm text-gray-600">
              {new Date(issue.created_at).toLocaleDateString()}
            </p>
          </div>
        </div>
        <span className="text-right text-sm text-gray-500">{discussionLabel}</span>
      </div>

      {isExpanded && (
        <div className="ml-6 mt-4 space-y-4">
          {issue.body ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <MarkdownBody body={issue.body} bodyHtml={issue.body_html} />
            </div>
          ) : null}

          {issue.prInfo && issue.changedFiles.length > 0 ? (
            <ComparatorViewer
              title={`${issue.prInfo.headRef} to ${issue.prInfo.baseRef}`}
              subtitle="Contrast perubahan kode Before - After untuk pull request ini."
              files={issue.changedFiles}
              selectedFile={selectedFile}
              onSelectFile={(filename) => onSelectComparatorFile(issue.number, filename)}
              badge={`${issue.changedFiles.length} changed files`}
            />
          ) : null}

          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="font-semibold">Issue Discussion</h4>
                {issue.comments.length > 0 && (
                  <button
                    onClick={() => onToggleIssueComments(issue.number)}
                    className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
                  >
                    {isCommentsExpanded ? "Hide details" : "Show details"}
                  </button>
                )}
              </div>
              {issue.comments.length === 0 ? (
                <p className="text-gray-500">No issue discussion yet.</p>
              ) : isCommentsExpanded ? (
                issue.comments.map((comment) => (
                  <div
                    key={comment.id}
                    className="mb-3 rounded-md border border-slate-200 bg-white p-3"
                  >
                    <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                      <span>{comment.user.login}</span>
                      <span>{new Date(comment.created_at).toLocaleString()}</span>
                    </div>
                    <MarkdownBody body={comment.body} bodyHtml={comment.body_html} />
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-600">
                  {issue.comments.length} comments hidden
                </p>
              )}
            </div>

            {issue.reviewComments.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="font-semibold">Review Comments</h4>
                  <button
                    onClick={() => onToggleIssueReviews(issue.number)}
                    className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
                  >
                    {isReviewsExpanded ? "Hide details" : "Show details"}
                  </button>
                </div>
                {isReviewsExpanded ? (
                  issue.reviewComments.map((comment) => (
                    <div
                      key={comment.id}
                      className="mb-3 rounded-md border border-slate-200 bg-white p-3"
                    >
                      <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                        <span>{comment.user.login}</span>
                        <span>{new Date(comment.created_at).toLocaleString()}</span>
                      </div>
                      <MarkdownBody body={comment.body} bodyHtml={comment.body_html} />
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-600">
                    {issue.reviewComments.length} review comments hidden
                  </p>
                )}
              </div>
            )}

            {issue.commits.length === 0 ? (
              <p className="text-gray-500">No commits associated with this issue.</p>
            ) : (
              issue.commits.map((commit) => (
                <div key={commit.sha} className="border-l-2 border-gray-300 pl-4">
                  <div
                    className="flex cursor-pointer items-start justify-between"
                    onClick={() => onToggleCommit(commit.sha)}
                  >
                    <div className="flex items-center gap-3">
                      <span>{expandedCommits.has(commit.sha) ? "▼" : "▶"}</span>
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          <a
                            href={commit.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500"
                          >
                            {expandedCommitMessages.has(commit.sha)
                              ? commit.commit.message
                              : commit.commit.message.length > 100
                                ? `${commit.commit.message.substring(0, 100)}...`
                                : commit.commit.message}
                          </a>
                        </p>
                        <p className="text-xs text-gray-600">
                          {commit.commit.author.name} -{" "}
                          {new Date(commit.commit.author.date).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <button
                      className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleFullMessage(commit.sha);
                      }}
                    >
                      {expandedCommitMessages.has(commit.sha)
                        ? "Hide full message"
                        : "Show full message"}
                    </button>
                  </div>

                  {expandedCommits.has(commit.sha) && (
                    <div className="ml-6 mt-3 space-y-3">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                        <div className="mb-3 flex items-center justify-between text-sm text-slate-500">
                          <span>File changes</span>
                          <div className="flex items-center gap-3">
                            {loadingCommitShas.has(commit.sha) && (
                              <span className="text-xs text-slate-400">
                                Loading diff...
                              </span>
                            )}
                            <button
                              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
                              onClick={() => onToggleFullDiff(commit.sha)}
                            >
                              {expandedDiffs.has(commit.sha)
                                ? "Hide full diff"
                                : "Show full diff"}
                            </button>
                          </div>
                        </div>
                        {commit.diffs.map((diff, index) => (
                          <div
                            key={index}
                            className="mb-3 rounded-md border border-slate-200 bg-white p-3"
                          >
                            <p className="mb-2 text-xs font-mono text-slate-800">
                              {diff.filename}
                            </p>
                            {expandedDiffs.has(commit.sha) ? (
                              <div className="overflow-x-auto rounded bg-slate-50 p-2">
                                {diff.patch.split("\n").map((line, lineIndex) => (
                                  <div
                                    key={lineIndex}
                                    className={`${DiffParser.getLineClass(line)} px-1 font-mono text-xs whitespace-pre-wrap`}
                                  >
                                    {line || "\u00A0"}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <pre className="overflow-x-auto rounded bg-slate-50 p-2 font-mono text-xs whitespace-pre-wrap">
                                {diff.patch.length > 300
                                  ? `${diff.patch.substring(0, 300)}...`
                                  : diff.patch}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
