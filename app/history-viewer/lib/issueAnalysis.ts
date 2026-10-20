import type {
  HistoricalExportPayload,
  HistoricalIssueEntry,
  SummaryChangeContrastSeed,
  SummaryChangeKind,
  SummaryChangeSize,
} from "@/app/history-viewer/types";
import { getChangeSignificanceRule } from "@/app/history-viewer/lib/changeSignificanceRules";

export interface IssueMetrics {
  discussionCount: number;
  commitCount: number;
  fileChangedCount: number;
  codeChangeCount: number;
  additions: number;
  deletions: number;
  hunkCount: number;
}

export interface IssueDatasetMetrics extends IssueMetrics {
  issueCount: number;
}

function countPatchStats(issue: HistoricalIssueEntry) {
  let additions = 0;
  let deletions = 0;
  let hunkCount = 0;

  for (const commit of issue.commits) {
    for (const change of commit.codeChanges) {
      for (const line of (change.patch || "").split("\n")) {
        if (line.startsWith("@@")) {
          hunkCount += 1;
        } else if (line.startsWith("+") && !line.startsWith("+++")) {
          additions += 1;
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          deletions += 1;
        }
      }
    }
  }

  return { additions, deletions, hunkCount };
}

function uniqueChangedFiles(issue: HistoricalIssueEntry) {
  return new Set(
    issue.commits.flatMap((commit) =>
      commit.codeChanges.map((change) => change.filename),
    ),
  );
}

type PatchChangeLine = {
  kind: "add" | "delete";
  content: string;
  raw: string;
  filename: string;
  sha: string;
};

function isPatchAddition(line: string) {
  return line.startsWith("+") && !line.startsWith("+++");
}

function isPatchDeletion(line: string) {
  return line.startsWith("-") && !line.startsWith("---");
}

function stripDiffPrefix(line: string) {
  return line.slice(1).trim();
}

function isCommentLine(content: string) {
  return /^(\/\/|\/\*|\*|#|<!--|-->|;)/.test(content.trim());
}

function getRawContent(line: PatchChangeLine) {
  return line.raw.slice(1);
}

function getIndentDepth(line: PatchChangeLine) {
  return getRawContent(line).match(/^\s*/)?.[0].length || 0;
}

function getDeclarationInfo(content: string) {
  const classMatch = content.match(/\bclass\s+([A-Za-z0-9_$]+)/);
  if (classMatch) {
    return {
      kind: "class" as const,
      name: classMatch[1],
    };
  }

  const interfaceMatch = content.match(
    /\b(?:interface|type|enum)\s+([A-Za-z0-9_$]+)/,
  );
  if (interfaceMatch) {
    return {
      kind: "interface" as const,
      name: interfaceMatch[1],
    };
  }

  return null;
}

function isLoopConditionLine(content: string) {
  return /\b(for|while)\s*\(|\bdo\s*\{?/.test(content);
}

function isControlConditionLine(content: string) {
  return /\b(if|switch|case|catch)\b|[?].*:/.test(content);
}

function isElsePartLine(content: string) {
  return /\belse\b/.test(content);
}

function hasSameStringSet(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

function looksLikeCallableSignature(content: string) {
  return (
    /\bfunction\b/.test(content) ||
    /\)\s*(:\s*[^=>{;]+)?\s*=>/.test(content) ||
    /\b[A-Za-z0-9_$]+\s*\([^)]*\)\s*[:{=>]/.test(content)
  );
}

function extractParameterList(content: string) {
  if (!looksLikeCallableSignature(content)) {
    return null;
  }

  const match = content.match(/\(([^()]*)\)/);
  if (!match) {
    return null;
  }

  return match[1]
    .split(",")
    .map((param) => param.trim())
    .filter(Boolean)
    .map((param) => {
      const withoutDefault = param.split("=")[0].trim();
      const withoutRest = withoutDefault.replace(/^\.\.\./, "").trim();
      const [rawName, ...typeParts] = withoutRest.split(":");
      const name = rawName.replace(/[?{}\[\]\s]/g, "").trim();
      const type = typeParts.join(":").trim();

      return { name, type };
    });
}

function extractReturnType(content: string) {
  if (!looksLikeCallableSignature(content)) {
    return null;
  }

  const match = content.match(/\)\s*:\s*([^=>{;]+)\s*(?:=>|\{|;)/);
  return match?.[1]?.trim() || null;
}

function collectChangedPatchLines(issue: HistoricalIssueEntry) {
  const groups: PatchChangeLine[][] = [];

  for (const commit of issue.commits) {
    for (const change of commit.codeChanges) {
      let currentGroup: PatchChangeLine[] = [];

      for (const line of (change.patch || "").split("\n")) {
        if (line.startsWith("@@")) {
          if (currentGroup.length > 0) {
            groups.push(currentGroup);
          }
          currentGroup = [];
          continue;
        }

        if (!isPatchAddition(line) && !isPatchDeletion(line)) {
          continue;
        }

        currentGroup.push({
          kind: isPatchAddition(line) ? "add" : "delete",
          content: stripDiffPrefix(line),
          raw: line,
          filename: change.filename,
          sha: commit.sha,
        });
      }

      if (currentGroup.length > 0) {
        groups.push(currentGroup);
      }
    }
  }

  return groups;
}

export function calculateIssueMetrics(issue: HistoricalIssueEntry): IssueMetrics {
  const { additions, deletions, hunkCount } = countPatchStats(issue);
  const fileChangedCount = uniqueChangedFiles(issue).size;
  const codeChangeCount = issue.commits.reduce(
    (total, commit) => total + commit.codeChanges.length,
    0,
  );

  return {
    discussionCount: issue.discussion.length,
    commitCount: issue.commits.length,
    fileChangedCount,
    codeChangeCount,
    additions,
    deletions,
    hunkCount,
  };
}

export function calculateDatasetMetrics(
  payload: HistoricalExportPayload,
): IssueDatasetMetrics {
  return payload.issues.reduce(
    (totals, issue) => {
      const metrics = calculateIssueMetrics(issue);
      return {
        issueCount: totals.issueCount + 1,
        discussionCount: totals.discussionCount + metrics.discussionCount,
        commitCount: totals.commitCount + metrics.commitCount,
        fileChangedCount: totals.fileChangedCount + metrics.fileChangedCount,
        codeChangeCount: totals.codeChangeCount + metrics.codeChangeCount,
        additions: totals.additions + metrics.additions,
        deletions: totals.deletions + metrics.deletions,
        hunkCount: totals.hunkCount + metrics.hunkCount,
      };
    },
    {
      issueCount: 0,
      discussionCount: 0,
      commitCount: 0,
      fileChangedCount: 0,
      codeChangeCount: 0,
      additions: 0,
      deletions: 0,
      hunkCount: 0,
    },
  );
}

export function classifyChangeSize(metrics: IssueMetrics): SummaryChangeSize {
  const weightedScope =
    metrics.fileChangedCount * 3 +
    metrics.commitCount * 2 +
    metrics.hunkCount +
    Math.ceil((metrics.additions + metrics.deletions) / 40);

  if (
    weightedScope >= 24 ||
    metrics.fileChangedCount >= 8 ||
    metrics.commitCount >= 5 ||
    metrics.hunkCount >= 12
  ) {
    return {
      level: "large",
      rationale:
        "The change spans many files, commits, or hunks, so it has a broad cross-area impact.",
    };
  }

  if (
    weightedScope >= 10 ||
    metrics.fileChangedCount >= 3 ||
    metrics.commitCount >= 2 ||
    metrics.hunkCount >= 4
  ) {
    return {
      level: "medium",
      rationale:
        "The change covers more than one code area and represents a meaningful revision, but it does not span many major areas.",
    };
  }

  return {
    level: "small",
    rationale:
      "The change is localized to a small number of files or hunks, so its impact scope is limited.",
  };
}

export function inferChangeContrastSeeds(
  issue: HistoricalIssueEntry,
): SummaryChangeContrastSeed[] {
  const patchGroups = collectChangedPatchLines(issue);
  const hints = new Map<SummaryChangeKind, SummaryChangeContrastSeed>();

  const register = (
    changeKind: SummaryChangeKind,
    sha: string,
    filename: string,
  ) => {
    const rule = getChangeSignificanceRule(changeKind);
    const existing = hints.get(changeKind);
    if (existing) {
      if (!existing.relatedCommitIds.includes(sha)) {
        existing.relatedCommitIds.push(sha);
      }
      const patchRef = `patch:${sha}:${filename}`;
      if (!existing.evidenceRefs.includes(patchRef)) {
        existing.evidenceRefs.push(patchRef);
      }
      return;
    }

    hints.set(changeKind, {
      change: changeKind,
      significance: rule.significance,
      group: rule.group,
      reason: rule.reason,
      relatedCommitIds: [sha],
      evidenceRefs: [`patch:${sha}:${filename}`],
      evidenceSource: "patch_excerpt",
    });
  };

  for (const group of patchGroups) {
    const changedLines = group.filter((entry) => entry.content.length > 0);
    if (changedLines.length === 0) {
      continue;
    }

    const addedLines = changedLines.filter((entry) => entry.kind === "add");
    const deletedLines = changedLines.filter((entry) => entry.kind === "delete");
    const codeLines = changedLines.filter((entry) => !isCommentLine(entry.content));
    const commentLines = changedLines.filter((entry) =>
      isCommentLine(entry.content),
    );
    const hasAdded = addedLines.length > 0;
    const hasDeleted = deletedLines.length > 0;

    if (commentLines.length > 0) {
      const hasAddedComment = commentLines.some((entry) => entry.kind === "add");
      const hasDeletedComment = commentLines.some(
        (entry) => entry.kind === "delete",
      );
      register(
        hasAddedComment && hasDeletedComment
          ? "Comment update"
          : "Comment insert/delete",
        commentLines[0].sha,
        commentLines[0].filename,
      );
    }

    if (codeLines.length > 0) {
      register(
        hasAdded && hasDeleted ? "Statement update" : "Statement insert/delete",
        codeLines[0].sha,
        codeLines[0].filename,
      );
    }

    const deletedByTrimmedContent = new Map<string, PatchChangeLine[]>();
    for (const deletedLine of deletedLines) {
      const matchingLines =
        deletedByTrimmedContent.get(deletedLine.content.trim()) || [];
      deletedByTrimmedContent.set(deletedLine.content.trim(), [
        ...matchingLines,
        deletedLine,
      ]);
    }

    for (const addedLine of addedLines) {
      const matchingDeletedLines = deletedByTrimmedContent.get(
        addedLine.content.trim(),
      );
      if (matchingDeletedLines?.length) {
        const movedAcrossScope = matchingDeletedLines.some(
          (deletedLine) =>
            getIndentDepth(deletedLine) !== getIndentDepth(addedLine),
        );
        register(
          movedAcrossScope
            ? "Statement parent change"
            : "Statement ordering change",
          addedLine.sha,
          addedLine.filename,
        );
      }
    }

    for (const entry of codeLines) {
      const declarationInfo = getDeclarationInfo(entry.content);

      if (isLoopConditionLine(entry.content)) {
        register("Loop condition", entry.sha, entry.filename);
      }

      if (isControlConditionLine(entry.content)) {
        register("Control structure condition", entry.sha, entry.filename);
      }

      if (isElsePartLine(entry.content)) {
        register(
          entry.kind === "add" ? "Else-part insert" : "Else-part delete",
          entry.sha,
          entry.filename,
        );
      }

      if (declarationInfo) {
        const oppositeLines = entry.kind === "add" ? deletedLines : addedLines;
        const hasMatchingOppositeDeclaration = oppositeLines.some((line) => {
          const oppositeDeclarationInfo = getDeclarationInfo(line.content);
          return (
            oppositeDeclarationInfo?.kind === declarationInfo.kind &&
            oppositeDeclarationInfo.name === declarationInfo.name
          );
        });
        const isClass = declarationInfo.kind === "class";

        register(
          isClass
            ? hasMatchingOppositeDeclaration
              ? "Class update"
              : "Class insert/delete"
            : hasMatchingOppositeDeclaration
              ? "Interface update"
              : "Interface insert/delete",
          entry.sha,
          entry.filename,
        );
      }
    }

    const pairedCount = Math.min(addedLines.length, deletedLines.length);
    for (let index = 0; index < pairedCount; index += 1) {
      const before = deletedLines[index];
      const after = addedLines[index];
      const beforeParams = extractParameterList(before.content);
      const afterParams = extractParameterList(after.content);

      if (beforeParams && afterParams) {
        const beforeNames = beforeParams.map((param) => param.name);
        const afterNames = afterParams.map((param) => param.name);

        if (beforeParams.length !== afterParams.length) {
          register("Parameter insert/delete", after.sha, after.filename);
        } else if (
          hasSameStringSet(beforeNames, afterNames) &&
          beforeNames.join(",") !== afterNames.join(",")
        ) {
          register("Parameter ordering change", after.sha, after.filename);
        } else if (beforeNames.join(",") !== afterNames.join(",")) {
          register("Parameter renaming", after.sha, after.filename);
        }

        const afterParamsByName = new Map(
          afterParams.map((afterParam) => [afterParam.name, afterParam]),
        );
        const hasTypeChange = beforeParams.some((beforeParam, paramIndex) => {
          const afterParam =
            afterParamsByName.get(beforeParam.name) || afterParams[paramIndex];
          return (
            afterParam &&
            beforeParam.name === afterParam.name &&
            beforeParam.type &&
            afterParam.type &&
            beforeParam.type !== afterParam.type
          );
        });

        if (hasTypeChange) {
          register("Parameter type change", after.sha, after.filename);
        }
      }

      const beforeLooksCallable = looksLikeCallableSignature(before.content);
      const afterLooksCallable = looksLikeCallableSignature(after.content);
      const beforeReturnType = extractReturnType(before.content);
      const afterReturnType = extractReturnType(after.content);
      if (
        beforeLooksCallable &&
        afterLooksCallable &&
        ((beforeReturnType && !afterReturnType) ||
          (!beforeReturnType && afterReturnType))
      ) {
        register("Return type insert/delete", after.sha, after.filename);
      } else if (
        beforeReturnType &&
        afterReturnType &&
        beforeReturnType !== afterReturnType
      ) {
        register("Return type update", after.sha, after.filename);
      }
    }
  }

  return [...hints.values()];
}
