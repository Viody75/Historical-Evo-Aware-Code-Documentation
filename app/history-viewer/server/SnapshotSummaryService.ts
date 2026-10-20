import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  calculateIssueMetrics,
  classifyChangeSize,
  inferChangeContrastSeeds,
} from "@/app/history-viewer/lib/issueAnalysis";
import { createHistoryTree } from "@/app/history-viewer/lib/historyTree";
import { renderIssueSummaryMarkdown } from "@/app/history-viewer/lib/historySummary";
import type {
  GeneratedIssueSummary,
  HistoricalDiscussionEntry,
  HistoricalExportPayload,
  HistoricalIssueEntry,
  SnapshotAstArtifact,
  SummaryChangeContrastEntry,
  SummaryChangeContrastSeed,
  SnapshotSummaryIndex,
} from "@/app/history-viewer/types";

const SUMMARY_MODEL = "gpt-5-mini";
const DISCUSSION_EXCERPT_LENGTH = 2_000;
const PATCH_EXCERPT_LENGTH = 6_000;
const PATCH_EXCERPT_LINES = 120;
const TOTAL_PATCH_BUDGET = 60_000;
const TEMPLATE_PATH = path.join(
  process.cwd(),
  "docs",
  "pr-sum-standard",
  "template.txt",
);

type GeneratedChangeContrastNarrative = Pick<
  SummaryChangeContrastEntry,
  "before" | "after" | "rationale"
>;

type GeneratedSummaryShape = {
  relatedIssue: string | null;
  background: string;
  whatChanged: GeneratedIssueSummary["whatChanged"];
  changeContrast: GeneratedChangeContrastNarrative[];
  impact: GeneratedIssueSummary["impact"];
  testingVerification: string[];
  notes: string[];
};

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
    .replace(/```(?:\w+)?\n?([\s\S]*?)```/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
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

function truncateDiscussion(value: string) {
  if (value.length <= DISCUSSION_EXCERPT_LENGTH) {
    return value;
  }

  const omissionMarker = " ... [middle omitted] ... ";
  const availableLength = DISCUSSION_EXCERPT_LENGTH - omissionMarker.length;
  const headLength = Math.floor(availableLength * 0.75);
  const tailLength = availableLength - headLength;

  return `${value.slice(0, headLength)}${omissionMarker}${value.slice(-tailLength)}`;
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
      body: truncateDiscussion(stripMarkdown(entry.body)),
    }));
}

const SIGNIFICANCE_PRIORITY = {
  Crucial: 4,
  Medium: 3,
  Low: 2,
  None: 1,
} as const;

function buildPatchExcerpt(patch: string, availableCharacters: number) {
  const maxLength = Math.min(PATCH_EXCERPT_LENGTH, availableCharacters);
  if (maxLength < 4) {
    return "";
  }

  return truncateText(
    patch.split("\n").slice(0, PATCH_EXCERPT_LINES).join("\n"),
    maxLength,
  );
}

function summarizeCommits(
  issue: HistoricalIssueEntry,
  seeds: SummaryChangeContrastSeed[],
) {
  let remainingPatchBudget = TOTAL_PATCH_BUDGET;
  const classificationsByPatch = new Map<
    string,
    Array<Pick<SummaryChangeContrastSeed, "change" | "significance">>
  >();

  for (const seed of seeds) {
    for (const evidenceRef of seed.evidenceRefs) {
      const classifications = classificationsByPatch.get(evidenceRef) || [];
      classifications.push({
        change: seed.change,
        significance: seed.significance,
      });
      classificationsByPatch.set(evidenceRef, classifications);
    }
  }

  const patchExcerpts = new Map<string, string>();
  const patchCandidates = issue.commits.flatMap((commit) =>
    commit.codeChanges.map((change, sourceIndex) => {
      const patchRef = `patch:${commit.sha}:${change.filename}`;
      const classifications = classificationsByPatch.get(patchRef) || [];
      const priority = classifications.reduce(
        (highest, classification) =>
          Math.max(highest, SIGNIFICANCE_PRIORITY[classification.significance]),
        0,
      );

      return { change, sourceIndex, patchRef, priority };
    }),
  );

  patchCandidates
    .sort(
      (left, right) =>
        right.priority - left.priority || left.sourceIndex - right.sourceIndex,
    )
    .forEach(({ change, patchRef }) => {
      const excerpt = buildPatchExcerpt(change.patch, remainingPatchBudget);
      patchExcerpts.set(patchRef, excerpt);
      remainingPatchBudget -= excerpt.length;
    });

  return issue.commits.map((commit) => {
    const files = commit.codeChanges.map((change) => {
      const patchRef = `patch:${commit.sha}:${change.filename}`;
      const classifications = classificationsByPatch.get(patchRef) || [];
      const patchExcerpt = patchExcerpts.get(patchRef) || "";

      return {
        filename: change.filename,
        patchRef,
        classifications,
        patchExcerpt,
        patchTruncated: patchExcerpt.length < change.patch.length,
      };
    });

    return {
      sha: commit.sha,
      shortSha: commit.sha.slice(0, 7),
      commitRef: `commit:${commit.sha}`,
      message: commit.message,
      author: commit.author,
      committedAt: commit.committedAt,
      files,
    };
  });
}

function buildPromptInput(issue: HistoricalIssueEntry) {
  const metrics = calculateIssueMetrics(issue);
  const changeContrastSeeds = inferChangeContrastSeeds(issue);

  return {
    issueNumber: issue.issueNumber,
    title: issue.title,
    issueUrl: issue.url,
    summary: truncateText(stripMarkdown(issue.summary || ""), 2000),
    metrics,
    changeContrastSeeds: changeContrastSeeds.map((seed, index) => ({
      index,
      change: seed.change,
      significance: seed.significance,
      group: seed.group,
      reason: seed.reason,
      relatedCommitIds: seed.relatedCommitIds,
      evidenceRefs: seed.evidenceRefs,
      evidenceSource: seed.evidenceSource,
    })),
    discussion: summarizeDiscussion(issue),
    commits: summarizeCommits(issue, changeContrastSeeds),
  };
}

function createIssueSourceFingerprint(issue: HistoricalIssueEntry) {
  return JSON.stringify({
    issueNumber: issue.issueNumber,
    title: issue.title,
    summary: issue.summary || "",
    discussion: issue.discussion.map((entry) => ({
      id: entry.id,
      type: entry.type,
      createdAt: entry.createdAt,
      body: entry.body,
    })),
    commits: issue.commits.map((commit) => ({
      sha: commit.sha,
      message: commit.message,
      committedAt: commit.committedAt,
      changes: commit.codeChanges.map((change) => ({
        filename: change.filename,
        patch: change.patch,
      })),
    })),
  });
}

function getIssueLastCommitAt(issue: HistoricalIssueEntry) {
  const commitTimes = issue.commits
    .map((commit) => new Date(commit.committedAt).getTime())
    .filter((time) => Number.isFinite(time));

  if (commitTimes.length === 0) {
    return null;
  }

  return new Date(Math.max(...commitTimes)).toISOString();
}

function mergeChangeContrastEntries(input: {
  seeds: SummaryChangeContrastSeed[];
  narratives: GeneratedChangeContrastNarrative[] | undefined;
}) {
  return input.seeds.map((seed, index) => {
    const narrative = input.narratives?.[index];

    return {
      change: seed.change,
      significance: seed.significance,
      group: seed.group,
      before: narrative?.before || "Before state was not described.",
      after: narrative?.after || "After state was not described.",
      rationale: narrative?.rationale || seed.reason,
      relatedCommitIds: seed.relatedCommitIds,
      evidenceRefs: seed.evidenceRefs,
      evidenceSource: seed.evidenceSource,
    } satisfies SummaryChangeContrastEntry;
  });
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
        "changeContrast",
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
        changeContrast: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "before",
              "after",
              "rationale",
            ],
            properties: {
              before: { type: "string" },
              after: { type: "string" },
              rationale: { type: "string" },
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
                "Write every generated narrative field in English, even when the source discussion uses another language.",
                "Use only commit IDs provided in the issue context.",
                "Use only evidence reference IDs provided in the issue context.",
                "Treat the human-written PR summary/body and human discussion as the primary evidence for intent, motivation, and the final conclusion.",
                "Use commit messages and patch excerpts to verify what implementation changed and whether it supports that discussion-derived conclusion.",
                "Patch classifications are navigation pointers to relevant code, not independent proof of author intent.",
                "When discussion and code appear inconsistent, report the discrepancy cautiously instead of replacing the discussion with a code-only assumption.",
                "Do not invent rationale. If the reason is only inferred from the code changes, keep it cautious and mark evidenceSource as inferred.",
                "Each whatChanged item must include evidenceSource with one of: discussion, commit_message, patch_excerpt, inferred.",
                "Each whatChanged item must include evidenceRefs that point to concrete evidence IDs from the provided context.",
                "Every rationale must explain three parts clearly: cause, effect, and solution.",
                "Use this exact English structure for every rationale: 'Because [cause]. Therefore, [effect]. Solution: [implemented solution].'",
                "Also produce changeContrast entries to capture before-vs-after contrast for the provided local significance seeds.",
                "Do not invent or rename change labels or significance levels. The local system has already fixed the change label, significance, evidence refs, commit ids, and evidence source for each changeContrast seed.",
                "Return one changeContrast item for each provided seed and preserve the same order.",
                "Each changeContrast entry must explain the reason for the change in the rationale field using the same cause-effect-solution pattern.",
                "The before and after fields should summarize the contrast, not quote large code snippets.",
                "Use the provided computed metrics and local changeContrast seeds as deterministic support, but do not repeat them mechanically.",
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
    previousIndex?: SnapshotSummaryIndex | null;
    forceRegenerate?: boolean;
  }) {
    const model = input.model?.trim() || SUMMARY_MODEL;
    const template = await this.loadTemplate();
    const generatedAt = new Date().toISOString();
    const previousIssueSummaries = new Map(
      (input.previousIndex?.issues || []).map((issue) => [
        issue.issueNumber,
        issue,
      ]),
    );

    const issues: GeneratedIssueSummary[] = [];

    for (const issue of input.payload.issues) {
      const metrics = calculateIssueMetrics(issue);
      const changeSize = classifyChangeSize(metrics);
      const changeContrastSeeds = inferChangeContrastSeeds(issue);
      const sourceFingerprint = createIssueSourceFingerprint(issue);
      const sourceLastCommitAt = getIssueLastCommitAt(issue);
      const previousIssueSummary = previousIssueSummaries.get(issue.issueNumber);

      if (
        !input.forceRegenerate &&
        previousIssueSummary?.sourceFingerprint === sourceFingerprint &&
        previousIssueSummary.model === model
      ) {
        issues.push({
          ...previousIssueSummary,
          title: issue.title,
          pullRequest: `PR #${issue.issueNumber}`,
          significanceFlags: changeContrastSeeds,
          changeSize,
          metrics,
          sourceLastCommitAt,
          sourceFingerprint,
          reusedFromGeneratedAt:
            previousIssueSummary.reusedFromGeneratedAt ||
            previousIssueSummary.generatedAt,
        });
        continue;
      }

      const summary = await callOpenAiSummaryApi({
        apiKey: input.apiKey,
        issue,
        model,
      });
      const changeContrast = mergeChangeContrastEntries({
        seeds: changeContrastSeeds,
        narratives: summary.changeContrast,
      });

      const markdownFile = `issue-${issue.issueNumber}.md`;
      const markdown = renderIssueSummaryMarkdown(template, {
        issueNumber: issue.issueNumber,
        title: issue.title,
        relatedIssue: summary.relatedIssue,
        pullRequest: `PR #${issue.issueNumber}`,
        background: summary.background,
        whatChanged: summary.whatChanged,
        significanceFlags: changeContrastSeeds,
        changeContrast,
        changeSize,
        metrics,
        impact: summary.impact,
        testingVerification: summary.testingVerification,
        notes: summary.notes,
        markdownFile,
        generatedAt,
        model,
        sourceLastCommitAt,
        sourceFingerprint,
        reusedFromGeneratedAt: null,
      });

      issues.push({
        issueNumber: issue.issueNumber,
        title: issue.title,
        relatedIssue: summary.relatedIssue,
        pullRequest: `PR #${issue.issueNumber}`,
        background: summary.background,
        whatChanged: summary.whatChanged,
        significanceFlags: changeContrastSeeds,
        changeContrast,
        changeSize,
        metrics,
        impact: summary.impact,
        testingVerification: summary.testingVerification,
        notes: summary.notes,
        markdown,
        markdownFile,
        generatedAt,
        model,
        sourceLastCommitAt,
        sourceFingerprint,
        reusedFromGeneratedAt: null,
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
