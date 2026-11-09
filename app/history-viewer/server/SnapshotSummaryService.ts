import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  calculateIssueMetrics,
  classifyChangeSize,
  inferChangeContrastSeeds,
} from "@/app/history-viewer/lib/issueAnalysis";
import { createHistoryTree } from "@/app/history-viewer/lib/historyTree";
import { renderIssueSummaryMarkdown } from "@/app/history-viewer/lib/historySummary";
import { PostgresHistoryStore } from "@/app/history-viewer/server/PostgresHistoryStore";
import type {
  GeneratedIssueSummary,
  HistoricalDiscussionEntry,
  HistoricalExportPayload,
  HistoricalIssueEntry,
  RagRetrievedDocument,
  SnapshotAstArtifact,
  SummaryRetrievalContext,
  SummaryTemporalDirection,
  SummaryChangeContrastEntry,
  SummaryChangeContrastSeed,
  SnapshotSummaryIndex,
} from "@/app/history-viewer/types";

const SUMMARY_MODEL = "gpt-5-mini";
const DISCUSSION_EXCERPT_LENGTH = 2_000;
const PATCH_EXCERPT_LENGTH = 6_000;
const PATCH_EXCERPT_LINES = 120;
const TOTAL_PATCH_BUDGET = 60_000;
const TEMPORAL_CONTEXT_DOCUMENT_LIMIT = 8;
const TEMPORAL_CONTEXT_DIRECTION_LIMIT = 4;
const TEMPORAL_CONTEXT_DOCUMENT_LENGTH = 2_500;
const TOTAL_TEMPORAL_CONTEXT_BUDGET = 18_000;
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
  retrospectiveOutcomes: Array<{
    outcome: string;
    evidenceRefs: string[];
  }>;
  notes: string[];
};

type TemporalContextDocument = RagRetrievedDocument & {
  sourceAt: string | null;
  temporalDirection: SummaryTemporalDirection;
};

type TemporalContextPack = {
  query: string;
  targetAt: string | null;
  retrievalMethod: SummaryRetrievalContext["retrievalMethod"];
  documents: TemporalContextDocument[];
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

function buildTemporalPromptDocuments(documents: TemporalContextDocument[]) {
  let remainingCharacters = TOTAL_TEMPORAL_CONTEXT_BUDGET;

  return documents.flatMap((document) => {
    if (remainingCharacters <= 0) {
      return [];
    }

    const content = truncateText(
      document.content,
      Math.min(TEMPORAL_CONTEXT_DOCUMENT_LENGTH, remainingCharacters),
    );
    remainingCharacters -= content.length;

    return {
      documentId: document.id,
      kind: document.kind,
      issueNumber: document.issueNumber,
      commitSha: document.commitSha,
      filename: document.filename,
      title: document.title,
      sourceAt: document.sourceAt,
      temporalDirection: document.temporalDirection,
      evidenceRefs: document.evidenceRefs,
      content,
    };
  });
}

function buildPromptInput(
  issue: HistoricalIssueEntry,
  temporalContext: TemporalContextPack,
) {
  const metrics = calculateIssueMetrics(issue);
  const changeContrastSeeds = inferChangeContrastSeeds(issue);

  return {
    issueNumber: issue.issueNumber,
    title: issue.title,
    issueUrl: issue.url,
    temporalRole: "current",
    temporalAnchorAt: temporalContext.targetAt,
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
    retrievedEvolutionContext: {
      query: temporalContext.query,
      retrievalMethod: temporalContext.retrievalMethod,
      documents: buildTemporalPromptDocuments(temporalContext.documents),
    },
  };
}

function createIssueSourceFingerprint(
  issue: HistoricalIssueEntry,
  temporalContext: TemporalContextPack,
) {
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
    retrievedEvolutionContext: temporalContext.documents.map((document) => ({
      kind: document.kind,
      issueNumber: document.issueNumber,
      commitSha: document.commitSha,
      filename: document.filename,
      title: document.title,
      content: document.content,
      evidenceRefs: document.evidenceRefs,
      sourceAt: document.sourceAt,
      temporalDirection: document.temporalDirection,
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

function getIssueTemporalAnchor(issue: HistoricalIssueEntry) {
  return getIssueLastCommitAt(issue) || issue.createdAt || null;
}

const RETRIEVAL_STOP_WORDS = new Set([
  "about",
  "after",
  "before",
  "change",
  "changes",
  "from",
  "into",
  "pull",
  "request",
  "that",
  "this",
  "with",
  "yang",
  "untuk",
  "dari",
  "pada",
]);

function buildTemporalRetrievalQuery(issue: HistoricalIssueEntry) {
  const filenames = issue.commits.flatMap((commit) =>
    commit.codeChanges.map((change) => change.filename),
  );
  const sourceText = [
    ...filenames,
    issue.title,
    issue.summary || "",
    ...issue.commits.map((commit) => commit.message.split("\n")[0]),
  ].join(" ");
  const terms = [
    ...new Set(
      (sourceText.toLocaleLowerCase().match(/[\p{L}\p{N}_./-]{3,}/gu) || [])
        .map((term) => term.replace(/^[-./]+|[-./]+$/g, ""))
        .filter(
          (term) => term.length >= 3 && !RETRIEVAL_STOP_WORDS.has(term),
        ),
    ),
  ].slice(0, 18);

  return {
    filenames,
    query:
      terms.length > 0
        ? terms.map((term) => `"${term}"`).join(" OR ")
        : `"${issue.title.replaceAll('"', "").slice(0, 120)}"`,
  };
}

function getDocumentSourceAt(document: RagRetrievedDocument) {
  for (const key of [
    "sourceLastCommitAt",
    "committedAt",
    "createdAt",
    "generatedAt",
  ]) {
    const value = document.metadata[key];
    if (typeof value === "string" && Number.isFinite(new Date(value).getTime())) {
      return new Date(value).toISOString();
    }
  }

  return null;
}

function getTemporalDirection(
  sourceAt: string | null,
  targetAt: string | null,
): SummaryTemporalDirection {
  if (!sourceAt || !targetAt) {
    return "unknown";
  }

  const sourceTime = new Date(sourceAt).getTime();
  const targetTime = new Date(targetAt).getTime();
  if (sourceTime < targetTime) {
    return "past";
  }
  if (sourceTime > targetTime) {
    return "future";
  }
  return "current";
}

function selectTemporalDocuments(
  documents: RagRetrievedDocument[],
  targetAt: string | null,
) {
  const annotated = documents.map((document) => {
    const sourceAt = getDocumentSourceAt(document);
    return {
      ...document,
      sourceAt,
      temporalDirection: getTemporalDirection(sourceAt, targetAt),
    } satisfies TemporalContextDocument;
  });
  const selected = new Map<string, TemporalContextDocument>();

  for (const direction of ["past", "future"] as const) {
    annotated
      .filter((document) => document.temporalDirection === direction)
      .slice(0, TEMPORAL_CONTEXT_DIRECTION_LIMIT)
      .forEach((document) => selected.set(document.id, document));
  }

  for (const document of annotated) {
    if (selected.size >= TEMPORAL_CONTEXT_DOCUMENT_LIMIT) {
      break;
    }
    selected.set(document.id, document);
  }

  return [...selected.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, TEMPORAL_CONTEXT_DOCUMENT_LIMIT);
}

function buildRetrievalContextTrace(
  context: TemporalContextPack,
): SummaryRetrievalContext {
  return {
    query: context.query,
    targetAt: context.targetAt,
    retrievalMethod: context.retrievalMethod,
    documents: context.documents.map((document) => ({
      documentId: document.id,
      kind: document.kind,
      issueNumber: document.issueNumber,
      commitSha: document.commitSha,
      filename: document.filename,
      title: document.title,
      sourceAt: document.sourceAt,
      temporalDirection: document.temporalDirection,
      evidenceRefs: document.evidenceRefs,
      score: document.score,
    })),
  };
}

function sanitizeRetrospectiveOutcomes(
  outcomes: GeneratedSummaryShape["retrospectiveOutcomes"],
  temporalContext: TemporalContextPack,
) {
  const validFutureRefs = new Set(
    temporalContext.documents
      .filter((document) => document.temporalDirection === "future")
      .flatMap((document) => document.evidenceRefs),
  );

  return outcomes.flatMap((outcome) => {
    const evidenceRefs = outcome.evidenceRefs.filter((evidenceRef) =>
      validFutureRefs.has(evidenceRef),
    );
    return evidenceRefs.length > 0 ? [{ ...outcome, evidenceRefs }] : [];
  });
}

function sanitizeOriginalRationaleEvidence(
  rows: GeneratedIssueSummary["whatChanged"],
  issue: HistoricalIssueEntry,
  temporalContext: TemporalContextPack,
) {
  const allowedRefs = new Set<string>([`issue:${issue.issueNumber}`]);
  for (const discussion of issue.discussion) {
    allowedRefs.add(`${discussion.type}:${discussion.id}`);
  }
  for (const commit of issue.commits) {
    allowedRefs.add(`commit:${commit.sha}`);
    for (const change of commit.codeChanges) {
      allowedRefs.add(`patch:${commit.sha}:${change.filename}`);
    }
  }
  for (const document of temporalContext.documents) {
    if (document.temporalDirection !== "future") {
      document.evidenceRefs.forEach((evidenceRef) =>
        allowedRefs.add(evidenceRef),
      );
    }
  }

  return rows.map((row) => {
    const evidenceRefs = row.evidenceRefs.filter((evidenceRef) =>
      allowedRefs.has(evidenceRef),
    );
    if (evidenceRefs.length > 0) {
      return { ...row, evidenceRefs };
    }

    const relatedCommitRefs = row.relatedCommitIds.flatMap((commitId) => {
      const commit = issue.commits.find((entry) =>
        entry.sha.startsWith(commitId),
      );
      return commit ? [`commit:${commit.sha}`] : [];
    });

    return {
      ...row,
      evidenceRefs:
        relatedCommitRefs.length > 0
          ? relatedCommitRefs
          : [`issue:${issue.issueNumber}`],
      evidenceSource: "inferred" as const,
    };
  });
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
        "retrospectiveOutcomes",
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
        retrospectiveOutcomes: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["outcome", "evidenceRefs"],
            properties: {
              outcome: { type: "string" },
              evidenceRefs: {
                type: "array",
                items: { type: "string" },
              },
            },
          },
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
  temporalContext: TemporalContextPack;
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
                "Use retrievedEvolutionContext as supplementary historical evidence about the code evolution surrounding the current PR.",
                "A document marked past may explain an earlier constraint, decision, or alternative that influenced the current change.",
                "A document marked future must never be presented as the original motivation for the current change.",
                "Use future documents only in retrospectiveOutcomes to describe later impact, correction, replacement, or validation.",
                "Every retrospectiveOutcomes item must cite one or more evidenceRefs from a future document. Return an empty array when no supported future outcome exists.",
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
              text: JSON.stringify(
                buildPromptInput(input.issue, input.temporalContext),
              ),
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
  constructor(
    private readonly postgresStore = new PostgresHistoryStore(),
  ) {}

  async loadTemplate() {
    return readFile(TEMPLATE_PATH, "utf8");
  }

  getDefaultModel() {
    return SUMMARY_MODEL;
  }

  private async retrieveTemporalContext(input: {
    repo: string;
    snapshotId?: string;
    issue: HistoricalIssueEntry;
  }): Promise<TemporalContextPack> {
    const retrieval = buildTemporalRetrievalQuery(input.issue);
    const targetAt = getIssueTemporalAnchor(input.issue);
    if (!input.snapshotId || !this.postgresStore.isConfigured()) {
      return {
        query: retrieval.query,
        targetAt,
        retrievalMethod: "unavailable",
        documents: [],
      };
    }

    try {
      const result = await this.postgresStore.searchRagDocuments({
        repo: input.repo,
        snapshotId: input.snapshotId,
        question: retrieval.query,
        limit: 24,
        excludeIssueNumber: input.issue.issueNumber,
        filenames: retrieval.filenames,
      });

      return {
        query: retrieval.query,
        targetAt,
        retrievalMethod: result?.retrievalMethod || "unavailable",
        documents: selectTemporalDocuments(result?.documents || [], targetAt),
      };
    } catch {
      return {
        query: retrieval.query,
        targetAt,
        retrievalMethod: "unavailable",
        documents: [],
      };
    }
  }

  private async indexGeneratedSummary(input: {
    repo: string;
    snapshotId?: string;
    summary: GeneratedIssueSummary;
  }) {
    if (!input.snapshotId || !this.postgresStore.isConfigured()) {
      return;
    }

    try {
      await this.postgresStore.indexGeneratedSummaryForRag({
        repo: input.repo,
        snapshotId: input.snapshotId,
        summary: input.summary,
      });
    } catch {
      // Summary generation remains available when optional PostgreSQL indexing
      // is temporarily unavailable.
    }
  }

  async generateArtifacts(input: {
    apiKey: string;
    payload: HistoricalExportPayload;
    snapshotId?: string;
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

    const issueSummaries = new Map<number, GeneratedIssueSummary>();
    const chronologicalIssues = [...input.payload.issues].sort((left, right) => {
      const leftTime = new Date(getIssueTemporalAnchor(left) || 0).getTime();
      const rightTime = new Date(getIssueTemporalAnchor(right) || 0).getTime();
      return leftTime - rightTime || left.issueNumber - right.issueNumber;
    });

    for (const issue of chronologicalIssues) {
      const metrics = calculateIssueMetrics(issue);
      const changeSize = classifyChangeSize(metrics);
      const changeContrastSeeds = inferChangeContrastSeeds(issue);
      const temporalContext = await this.retrieveTemporalContext({
        repo: input.payload.repo,
        snapshotId: input.snapshotId,
        issue,
      });
      const retrievalContext = buildRetrievalContextTrace(temporalContext);
      const sourceFingerprint = createIssueSourceFingerprint(
        issue,
        temporalContext,
      );
      const sourceLastCommitAt = getIssueLastCommitAt(issue);
      const previousIssueSummary = previousIssueSummaries.get(issue.issueNumber);

      if (
        !input.forceRegenerate &&
        previousIssueSummary?.sourceFingerprint === sourceFingerprint &&
        previousIssueSummary.model === model
      ) {
        const reusedSummary = {
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
          retrievalContext,
        } satisfies GeneratedIssueSummary;
        issueSummaries.set(issue.issueNumber, reusedSummary);
        await this.indexGeneratedSummary({
          repo: input.payload.repo,
          snapshotId: input.snapshotId,
          summary: reusedSummary,
        });
        continue;
      }

      const summary = await callOpenAiSummaryApi({
        apiKey: input.apiKey,
        issue,
        model,
        temporalContext,
      });
      const changeContrast = mergeChangeContrastEntries({
        seeds: changeContrastSeeds,
        narratives: summary.changeContrast,
      });

      const retrospectiveOutcomes = sanitizeRetrospectiveOutcomes(
        summary.retrospectiveOutcomes,
        temporalContext,
      );
      const whatChanged = sanitizeOriginalRationaleEvidence(
        summary.whatChanged,
        issue,
        temporalContext,
      );
      const markdownFile = `issue-${issue.issueNumber}.md`;
      const summaryWithoutMarkdown = {
        issueNumber: issue.issueNumber,
        title: issue.title,
        relatedIssue: summary.relatedIssue,
        pullRequest: `PR #${issue.issueNumber}`,
        background: summary.background,
        whatChanged,
        significanceFlags: changeContrastSeeds,
        changeContrast,
        changeSize,
        metrics,
        impact: summary.impact,
        testingVerification: summary.testingVerification,
        retrospectiveOutcomes,
        notes: summary.notes,
        markdownFile,
        generatedAt,
        model,
        sourceLastCommitAt,
        sourceFingerprint,
        reusedFromGeneratedAt: null,
        retrievalContext,
      } satisfies Omit<GeneratedIssueSummary, "markdown">;
      const generatedSummary = {
        ...summaryWithoutMarkdown,
        markdown: renderIssueSummaryMarkdown(template, summaryWithoutMarkdown),
      } satisfies GeneratedIssueSummary;

      issueSummaries.set(issue.issueNumber, generatedSummary);
      await this.indexGeneratedSummary({
        repo: input.payload.repo,
        snapshotId: input.snapshotId,
        summary: generatedSummary,
      });
    }

    const issues = input.payload.issues.flatMap((issue) => {
      const summary = issueSummaries.get(issue.issueNumber);
      return summary ? [summary] : [];
    });

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
