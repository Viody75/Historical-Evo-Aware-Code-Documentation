import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type {
  GeneratedIssueSummary,
  HistoricalExportPayload,
  HistoricalIssueEntry,
  SnapshotQuantitativeTestingArtifact,
  SnapshotRecord,
  SnapshotSummaryIndex,
  QuantitativeTestingMetrics,
} from "@/app/history-viewer/types";

const execFileAsync = promisify(execFile);
const MAX_CLAIMS_PER_ISSUE = 24;
const MAX_CLAIM_LENGTH = 1_500;
const EVALUATION_SCHEMA_VERSION = 2;

type GroundTruthClaim = {
  id: string;
  text: string;
  evidenceRefs: string[];
  evidenceType: "issue" | "discussion" | "commit" | "patch";
};

function normalizeText(value: string | null | undefined, limit = MAX_CLAIM_LENGTH) {
  return (value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function patchExcerpt(patch: string) {
  return normalizeText(
    patch
      .split("\n")
      .filter(
        (line) =>
          (line.startsWith("+") && !line.startsWith("+++")) ||
          (line.startsWith("-") && !line.startsWith("---")),
      )
      .slice(0, 40)
      .join(" "),
  );
}

function buildIssueClaims(issue: HistoricalIssueEntry): GroundTruthClaim[] {
  const candidatesByType: Record<
    GroundTruthClaim["evidenceType"],
    Omit<GroundTruthClaim, "id">[]
  > = {
    issue: [],
    discussion: [],
    commit: [],
    patch: [],
  };
  const issueSummary = normalizeText(issue.summary);

  if (issueSummary) {
    candidatesByType.issue.push({
      text: issueSummary,
      evidenceRefs: [`issue:${issue.issueNumber}`],
      evidenceType: "issue",
    });
  }

  for (const discussion of issue.discussion) {
    const text = normalizeText(discussion.body);
    if (!text) {
      continue;
    }
    candidatesByType.discussion.push({
      text,
      evidenceRefs: [`${discussion.type}:${discussion.id}`],
      evidenceType: "discussion",
    });
  }

  for (const commit of issue.commits) {
    const message = normalizeText(commit.message);
    if (message) {
      candidatesByType.commit.push({
        text: message,
        evidenceRefs: [`commit:${commit.sha}`],
        evidenceType: "commit",
      });
    }

    for (const change of commit.codeChanges) {
      const excerpt = patchExcerpt(change.patch);
      if (!excerpt) {
        continue;
      }
      candidatesByType.patch.push({
        text: excerpt,
        evidenceRefs: [`patch:${commit.sha}:${change.filename}`],
        evidenceType: "patch",
      });
    }
  }

  if (Object.values(candidatesByType).every((items) => items.length === 0)) {
    candidatesByType.issue.push({
      text: issue.title,
      evidenceRefs: [`issue:${issue.issueNumber}`],
      evidenceType: "issue",
    });
  }

  const candidates: Omit<GroundTruthClaim, "id">[] = [];
  const queues = [
    candidatesByType.issue,
    candidatesByType.discussion,
    candidatesByType.commit,
    candidatesByType.patch,
  ].map((items) => [...items]);
  while (
    candidates.length < MAX_CLAIMS_PER_ISSUE &&
    queues.some((items) => items.length > 0)
  ) {
    for (const queue of queues) {
      const candidate = queue.shift();
      if (candidate) {
        candidates.push(candidate);
      }
      if (candidates.length === MAX_CLAIMS_PER_ISSUE) {
        break;
      }
    }
  }

  return candidates.map((candidate, index) => ({
    id: `RAW-${issue.issueNumber}-${String(index + 1).padStart(2, "0")}`,
    ...candidate,
  }));
}

function generatedClaims(summary: GeneratedIssueSummary) {
  return [
    ...(summary.discussionNarratives || []).map((entry, index) => ({
      id: `discussionNarrative:${index}`,
      text: [entry.narrative, entry.outcome].filter(Boolean).join(" "),
      evidenceRefs: entry.evidenceRefs,
      source: "discussionNarrative",
    })),
    ...summary.whatChanged.map((entry, index) => ({
      id: `whatChanged:${index}`,
      text: [entry.change, entry.rationale].filter(Boolean).join(" "),
      evidenceRefs: entry.evidenceRefs,
      evidenceSource: entry.evidenceSource,
      source: "whatChanged",
    })),
  ];
}

function withoutLegacyManualJudgments(
  groundTruth: Record<string, unknown>,
): Record<string, unknown> {
  const issues = Array.isArray(groundTruth.issues)
    ? groundTruth.issues.map((issue) => {
        if (!issue || typeof issue !== "object" || Array.isArray(issue)) {
          return issue;
        }

        const retainedIssue = { ...(issue as Record<string, unknown>) };
        delete retainedIssue.manualJudgments;
        return retainedIssue;
      })
    : groundTruth.issues;

  return { ...groundTruth, issues };
}

export class RationaleEvaluationService {
  createGroundTruthDraft(
    snapshot: SnapshotRecord,
    payload: HistoricalExportPayload,
    summaryIndex: SnapshotSummaryIndex,
  ): Record<string, unknown> {
    const generatedIssueNumbers = new Set(
      summaryIndex.issues.map((issue) => issue.issueNumber),
    );
    const issues = payload.issues
      .filter((issue) => generatedIssueNumbers.has(issue.issueNumber))
      .map((issue) => {
        const claims = buildIssueClaims(issue);
        return {
          issueNumber: issue.issueNumber,
          referenceRationale: claims.map((claim) => claim.text).join("\n"),
          claims,
          rawEvidenceSummary: {
            issueUrl: issue.url,
            discussionCount: issue.discussion.length,
            commitCount: issue.commits.length,
            patchCount: issue.commits.reduce(
              (total, commit) => total + commit.codeChanges.length,
              0,
            ),
            selectedClaimCount: claims.length,
          },
        };
      });

    return {
      dataset: `${payload.repo}-${snapshot.id}-raw-evidence-v1`,
      language: "en",
      groundTruthType: "raw-github-evidence-proxy",
      requiresHumanReview: true,
      annotatorProtocol:
        "Review referenceRationale and atomic claims against the PR body, human discussions, commit messages, and patches. Record any corrections before reporting BERTScore.",
      selectionPolicy: {
        maximumClaimsPerIssue: MAX_CLAIMS_PER_ISSUE,
        maximumCharactersPerClaim: MAX_CLAIM_LENGTH,
        evidenceSelection: "balanced-round-robin",
        evidenceTypes: ["issue", "discussion", "commit", "patch"],
      },
      issues,
    };
  }

  createGeneratedComparison(
    snapshot: SnapshotRecord,
    summaryIndex: SnapshotSummaryIndex,
  ): Record<string, unknown> {
    return {
      snapshotId: snapshot.id,
      repo: summaryIndex.repo,
      generatedAt: summaryIndex.generatedAt,
      model: summaryIndex.model,
      issues: summaryIndex.issues.map((summary) => ({
        issueNumber: summary.issueNumber,
        title: summary.title,
        generatedClaims: generatedClaims(summary),
        discussionNarratives: summary.discussionNarratives || [],
        whatChanged: summary.whatChanged,
      })),
    };
  }

  async getState(input: {
    snapshot: SnapshotRecord;
    payload: HistoricalExportPayload;
    summaryIndex: SnapshotSummaryIndex;
  }): Promise<SnapshotQuantitativeTestingArtifact> {
    const paths = this.getPaths(input.snapshot);
    const [savedGroundTruth, savedArtifact] = await Promise.all([
      this.readJson<Record<string, unknown>>(paths.groundTruth),
      this.readJson<SnapshotQuantitativeTestingArtifact>(paths.artifact),
    ]);
    const savedComparisonGeneratedAt =
      savedArtifact?.sourceSummaryGeneratedAt ||
      (savedArtifact?.generatedComparison &&
      typeof savedArtifact.generatedComparison.generatedAt === "string"
        ? savedArtifact.generatedComparison.generatedAt
        : null);
    const metricsMatchCurrentSummary =
      savedArtifact?.evaluationSchemaVersion === EVALUATION_SCHEMA_VERSION &&
      savedComparisonGeneratedAt === input.summaryIndex.generatedAt;

    return {
      evaluationSchemaVersion: EVALUATION_SCHEMA_VERSION,
      snapshotId: input.snapshot.id,
      generatedAt: metricsMatchCurrentSummary
        ? savedArtifact?.generatedAt || null
        : null,
      sourceSummaryGeneratedAt: input.summaryIndex.generatedAt,
      groundTruth:
        withoutLegacyManualJudgments(
          savedGroundTruth ||
            this.createGroundTruthDraft(
              input.snapshot,
              input.payload,
              input.summaryIndex,
            ),
        ),
      generatedComparison:
        (metricsMatchCurrentSummary && savedArtifact?.generatedComparison) ||
        this.createGeneratedComparison(input.snapshot, input.summaryIndex),
      metrics: metricsMatchCurrentSummary ? savedArtifact?.metrics || null : null,
    };
  }

  async run(input: {
    snapshot: SnapshotRecord;
    payload: HistoricalExportPayload;
    summaryIndex: SnapshotSummaryIndex;
    groundTruth: Record<string, unknown>;
    generatedComparison: Record<string, unknown>;
  }): Promise<SnapshotQuantitativeTestingArtifact> {
    const paths = this.getPaths(input.snapshot);
    const comparison = input.generatedComparison;
    const groundTruth = withoutLegacyManualJudgments(input.groundTruth);
    await mkdir(paths.directory, { recursive: true });
    await Promise.all([
      writeFile(
        paths.groundTruth,
        `${JSON.stringify(groundTruth, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        paths.comparison,
        `${JSON.stringify(comparison, null, 2)}\n`,
        "utf8",
      ),
    ]);

    const python = await this.resolvePythonExecutable();
    const scriptPath = path.join(
      process.cwd(),
      "scripts",
      "evaluate-rationales.py",
    );
    try {
      await execFileAsync(
        python,
        [
          scriptPath,
          "--generated-comparison",
          paths.comparison,
          "--ground-truth",
          paths.groundTruth,
          "--output",
          paths.metrics,
          "--allow-lexical-fallback",
        ],
        {
          cwd: process.cwd(),
          maxBuffer: 20 * 1024 * 1024,
          timeout: 10 * 60 * 1000,
        },
      );
    } catch (error) {
      const detail =
        error && typeof error === "object" && "stderr" in error
          ? String(error.stderr).trim()
          : "";
      throw new Error(detail || "Quantitative evaluation process failed");
    }

    const metrics = await this.readJson<QuantitativeTestingMetrics>(paths.metrics);
    if (!metrics) {
      throw new Error("Evaluation finished without a metrics artifact");
    }

    const artifact: SnapshotQuantitativeTestingArtifact = {
      evaluationSchemaVersion: EVALUATION_SCHEMA_VERSION,
      snapshotId: input.snapshot.id,
      generatedAt: new Date().toISOString(),
      sourceSummaryGeneratedAt: input.summaryIndex.generatedAt,
      groundTruth,
      generatedComparison: comparison,
      metrics,
    };
    await writeFile(paths.artifact, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    return artifact;
  }

  private getPaths(snapshot: SnapshotRecord) {
    const directory = path.join(snapshot.snapshotDir, "history", "evaluation");
    return {
      directory,
      groundTruth: path.join(directory, "ground-truth.json"),
      comparison: path.join(directory, "generated-comparison.json"),
      metrics: path.join(directory, "metrics.json"),
      artifact: path.join(directory, "quantitative-testing.json"),
    };
  }

  private async resolvePythonExecutable() {
    const configured = process.env.EVALUATION_PYTHON?.trim();
    if (configured) {
      return configured;
    }

    const virtualEnvironmentPython = path.join(
      process.cwd(),
      ".venv-evaluation",
      "bin",
      "python",
    );
    try {
      await access(virtualEnvironmentPython);
      return virtualEnvironmentPython;
    } catch {
      return "python3";
    }
  }

  private async readJson<T>(filePath: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(filePath, "utf8")) as T;
    } catch {
      return null;
    }
  }
}
