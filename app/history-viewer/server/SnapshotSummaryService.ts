import { readFile } from "node:fs/promises";
import path from "node:path";

import { createHistoryTree } from "@/app/history-viewer/lib/historyTree";
import { renderIssueSummaryMarkdown } from "@/app/history-viewer/lib/historySummary";
import type {
  GeneratedIssueSummary,
  HistoricalDiscussionEntry,
  HistoricalExportPayload,
  HistoricalIssueEntry,
  SnapshotAstArtifact,
  SnapshotSummaryIndex,
} from "@/app/history-viewer/types";

const SUMMARY_MODEL = "gpt-5-mini";
const TEMPLATE_PATH = path.join(
  process.cwd(),
  "docs",
  "pr-sum-standard",
  "template.txt",
);

type GeneratedSummaryShape = Omit<
  GeneratedIssueSummary,
  | "issueNumber"
  | "title"
  | "pullRequest"
  | "markdown"
  | "markdownFile"
  | "generatedAt"
  | "model"
>;

type ResponsesApiPayload = {
  error?: { message?: string };
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

function stripMarkdown(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[[^\]]+]\([^)]*\)/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyBotComment(entry: HistoricalDiscussionEntry) {
  const author = entry.author.toLowerCase();
  return author.includes("[bot]") || author.endsWith("bot");
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function summarizeDiscussion(issue: HistoricalIssueEntry) {
  return issue.discussion
    .filter((entry) => !isLikelyBotComment(entry))
    .map((entry) => ({
      discussionRef: `${entry.type}:${entry.id}`,
      discussionId: entry.id,
      discussionType: entry.type,
      author: entry.author,
      createdAt: entry.createdAt,
      body: truncateText(stripMarkdown(entry.body), 500),
    }));
}

function summarizeCommits(issue: HistoricalIssueEntry) {
  return issue.commits.map((commit) => ({
    sha: commit.sha,
    shortSha: commit.sha.slice(0, 7),
    commitRef: `commit:${commit.sha}`,
    message: commit.message.split("\n")[0] || commit.message,
    author: commit.author,
    committedAt: commit.committedAt,
    files: commit.codeChanges.map((change) => ({
      filename: change.filename,
      patchRef: `patch:${commit.sha}:${change.filename}`,
      patchExcerpt: truncateText(
        change.patch
          .split("\n")
          .filter((line) => line.startsWith("+") || line.startsWith("-"))
          .slice(0, 8)
          .join("\n"),
        900,
      ),
    })),
  }));
}

function buildPromptInput(issue: HistoricalIssueEntry) {
  return {
    issueNumber: issue.issueNumber,
    title: issue.title,
    issueUrl: issue.url,
    summary: truncateText(stripMarkdown(issue.summary || ""), 2000),
    discussion: summarizeDiscussion(issue),
    commits: summarizeCommits(issue),
  };
}

function createResponseSchema() {
  return {
    type: "json_schema" as const,
    name: "pr_summary",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "relatedIssue",
        "background",
        "whatChanged",
        "impact",
        "testingVerification",
        "notes",
      ],
      properties: {
        relatedIssue: {
          anyOf: [{ type: "string" }, { type: "null" }],
        },
        background: { type: "string" },
        whatChanged: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "change",
              "rationale",
              "relatedCommitIds",
              "evidenceRefs",
              "evidenceSource",
            ],
            properties: {
              change: { type: "string" },
              rationale: { type: "string" },
              relatedCommitIds: {
                type: "array",
                items: { type: "string" },
              },
              evidenceRefs: {
                type: "array",
                items: { type: "string" },
              },
              evidenceSource: {
                type: "string",
                enum: [
                  "discussion",
                  "commit_message",
                  "patch_excerpt",
                  "inferred",
                ],
              },
            },
          },
        },
        impact: {
          type: "object",
          additionalProperties: false,
          required: ["user", "system", "developer"],
          properties: {
            user: { type: "array", items: { type: "string" } },
            system: { type: "array", items: { type: "string" } },
            developer: { type: "array", items: { type: "string" } },
          },
        },
        testingVerification: {
          type: "array",
          items: { type: "string" },
        },
        notes: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
  };
}

function extractOutputText(payload: ResponsesApiPayload) {
  return (payload.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text" && content.text)
    .map((content) => content.text || "")
    .join("");
}

async function callOpenAiSummaryApi(input: {
  apiKey: string;
  issue: HistoricalIssueEntry;
  model: string;
}) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      reasoning: {
        effort: "low",
      },
      text: {
        verbosity: "low",
        format: createResponseSchema(),
      },
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "You generate standardized pull request summaries.",
                "Return compact JSON only.",
                "Use only commit IDs provided in the issue context.",
                "Use only evidence reference IDs provided in the issue context.",
                "Build rationale from the strongest available evidence in this priority order: human-written PR summary/body, human discussion, commit messages, then patch excerpts.",
                "Use patch excerpts only when the reason is not already clear from the summary, discussion, or commit messages.",
                "Do not invent rationale. If the reason is only inferred from the code changes, keep it cautious and mark evidenceSource as inferred.",
                "Each whatChanged item must include evidenceSource with one of: discussion, commit_message, patch_excerpt, inferred.",
                "Each whatChanged item must include evidenceRefs that point to concrete evidence IDs from the provided context.",
                "If evidenceSource is discussion, evidenceRefs should include discussion refs such as issue_comment:123 or review_comment:456.",
                "If evidenceSource is commit_message, evidenceRefs should include commit refs such as commit:<sha>.",
                "If evidenceSource is patch_excerpt, evidenceRefs should include patch refs such as patch:<sha>:<filename>.",
                "If evidenceSource is inferred, still include the closest supporting commit or patch reference when available.",
                "Prefer short, concrete rationale statements tied to real commits.",
                "Ignore bot-only noise and deployment chatter.",
              ].join(" "),
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(buildPromptInput(input.issue)),
            },
          ],
        },
      ],
    }),
  });

  const raw = (await response
    .json()
    .catch(() => null)) as ResponsesApiPayload | null;

  if (!response.ok) {
    throw new Error(raw?.error?.message || "OpenAI summary generation failed");
  }

  const outputText = raw ? extractOutputText(raw) : "";
  if (!outputText) {
    throw new Error("OpenAI did not return a structured summary");
  }

  return JSON.parse(outputText) as GeneratedSummaryShape;
}

export class SnapshotSummaryService {
  async loadTemplate() {
    return readFile(TEMPLATE_PATH, "utf8");
  }

  getDefaultModel() {
    return SUMMARY_MODEL;
  }

  async generateArtifacts(input: {
    apiKey: string;
    payload: HistoricalExportPayload;
    model?: string;
  }) {
    const model = input.model?.trim() || SUMMARY_MODEL;
    const template = await this.loadTemplate();
    const generatedAt = new Date().toISOString();

    const issues: GeneratedIssueSummary[] = [];

    for (const issue of input.payload.issues) {
      const summary = await callOpenAiSummaryApi({
        apiKey: input.apiKey,
        issue,
        model,
      });

      const markdownFile = `issue-${issue.issueNumber}.md`;
      const markdown = renderIssueSummaryMarkdown(template, {
        issueNumber: issue.issueNumber,
        title: issue.title,
        relatedIssue: summary.relatedIssue,
        pullRequest: `PR #${issue.issueNumber}`,
        background: summary.background,
        whatChanged: summary.whatChanged,
        impact: summary.impact,
        testingVerification: summary.testingVerification,
        notes: summary.notes,
        markdownFile,
        generatedAt,
        model,
      });

      issues.push({
        issueNumber: issue.issueNumber,
        title: issue.title,
        relatedIssue: summary.relatedIssue,
        pullRequest: `PR #${issue.issueNumber}`,
        background: summary.background,
        whatChanged: summary.whatChanged,
        impact: summary.impact,
        testingVerification: summary.testingVerification,
        notes: summary.notes,
        markdown,
        markdownFile,
        generatedAt,
        model,
      });
    }

    const index: SnapshotSummaryIndex = {
      repo: input.payload.repo,
      generatedAt,
      model,
      templatePath: "docs/pr-sum-standard/template.txt",
      issues,
    };

    const ast: SnapshotAstArtifact = {
      repo: input.payload.repo,
      generatedAt,
      tree: createHistoryTree(input.payload, index),
    };

    return { index, ast };
  }
}
