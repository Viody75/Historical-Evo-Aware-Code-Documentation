import type {
  HistoricalExportPayload,
  HistoricalIssueEntry,
  SummaryChangeAspect,
  SummaryChangeContrastSeed,
  SummaryChangeSize,
} from "@/app/history-viewer/types";

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

function collectPatchLines(issue: HistoricalIssueEntry) {
  return issue.commits.flatMap((commit) =>
    commit.codeChanges.flatMap((change) =>
      (change.patch || "").split("\n").map((line) => ({
        line,
        filename: change.filename,
        sha: commit.sha,
      })),
    ),
  );
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
      level: "besar",
      rationale:
        "Perubahan menjangkau banyak file, commit, atau hunk sehingga dampaknya lintas area cukup luas.",
    };
  }

  if (
    weightedScope >= 10 ||
    metrics.fileChangedCount >= 3 ||
    metrics.commitCount >= 2 ||
    metrics.hunkCount >= 4
  ) {
    return {
      level: "sedang",
      rationale:
        "Perubahan mencakup lebih dari satu area kode dan menunjukkan revisi yang terasa, tetapi belum lintas area besar.",
    };
  }

  return {
    level: "kecil",
    rationale:
      "Perubahan relatif terlokalisasi pada sedikit file atau hunk sehingga ruang dampaknya lebih sempit.",
  };
}

export function inferChangeContrastSeeds(
  issue: HistoricalIssueEntry,
): SummaryChangeContrastSeed[] {
  const lines = collectPatchLines(issue);
  const hints = new Map<SummaryChangeAspect, SummaryChangeContrastSeed>();

  const register = (
    aspect: SummaryChangeAspect,
    reason: string,
    sha: string,
    filename: string,
  ) => {
    const existing = hints.get(aspect);
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

    hints.set(aspect, {
      aspect,
      reason,
      relatedCommitIds: [sha],
      evidenceRefs: [`patch:${sha}:${filename}`],
      evidenceSource: "patch_excerpt",
    });
  };

  for (const entry of lines) {
    const content = entry.line.startsWith("+") || entry.line.startsWith("-")
      ? entry.line.slice(1).trim()
      : entry.line.trim();

    if (!content) {
      continue;
    }

    if (/\b(if|else|switch|case|return|&&|\|\||===|!==|<=|>=)\b/.test(content)) {
      register(
        "logic",
        "Patch menyentuh conditional atau branching yang mengubah alur keputusan program.",
        entry.sha,
        entry.filename,
      );
    }

    if (/\b(for|while|reduce|map|filter|sort|find|distance|nearest|closest)\b/.test(content)) {
      register(
        "algorithm",
        "Patch menyentuh cara perhitungan, iterasi, atau pemilihan hasil sehingga strategi pemrosesan kemungkinan berubah.",
        entry.sha,
        entry.filename,
      );
    }

    if (
      /\b(import|export|interface|type|class)\b/.test(content) ||
      /from\s+["']/.test(content)
    ) {
      register(
        "struktur kode",
        "Patch menunjukkan perubahan struktur modul, tipe, atau dependency yang menata ulang bentuk kode.",
        entry.sha,
        entry.filename,
      );
    }

    if (
      /\b(render|click|pointer|hover|focus|select|visible|hidden|highlight)\b/.test(
        content,
      )
    ) {
      register(
        "behavior",
        "Patch menyentuh interaksi atau output yang berpotensi mengubah perilaku yang dirasakan pengguna.",
        entry.sha,
        entry.filename,
      );
    }

    if (
      /\bfunction\b/.test(content) ||
      /\bconst\s+[A-Za-z0-9_$]+\s*=\s*\(/.test(content) ||
      /\b[A-Za-z0-9_$]+\s*:\s*\(/.test(content)
    ) {
      register(
        "functions",
        "Patch mengubah deklarasi atau batas fungsi sehingga kontrak atau tanggung jawab fungsi ikut bergeser.",
        entry.sha,
        entry.filename,
      );
    }
  }

  return [...hints.values()];
}
