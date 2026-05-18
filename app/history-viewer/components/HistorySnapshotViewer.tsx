"use client";

import { useState } from "react";

import { HistorySnapshotWorkspace } from "@/app/history-viewer/components/HistorySnapshotWorkspace";
import { LazyDetails } from "@/app/history-viewer/components/LazyDetails";
import { MarkdownBody } from "@/app/history-viewer/components/MarkdownBody";
import { GitHubHistoryApi } from "@/app/history-viewer/lib/GitHubHistoryApi";
import {
  calculateDatasetMetrics,
  calculateIssueMetrics,
} from "@/app/history-viewer/lib/issueAnalysis";
import type {
  HistoricalExportPayload,
  SnapshotRecord,
  SnapshotSummaryArtifacts,
  SummaryChangeSize,
} from "@/app/history-viewer/types";

function changeSizeTone(level?: SummaryChangeSize["level"]) {
  switch (level) {
    case "besar":
      return "border-rose-200 bg-rose-50 text-rose-900";
    case "sedang":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "kecil":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function ensureBecausePrefix(value?: string) {
  const normalized = value?.trim() || "";
  if (!normalized) {
    return "-";
  }

  if (/^karena\b/i.test(normalized)) {
    return normalized;
  }

  return `Karena ${normalized.charAt(0).toLowerCase()}${normalized.slice(1)}`;
}

function ensureStructuredRationale(value?: string) {
  const withBecause = ensureBecausePrefix(value);
  if (withBecause === "-") {
    return withBecause;
  }

  const trimmed = withBecause.replace(/[.!\s]+$/, "");
  const hasEffect =
    /\b(sehingga|maka|jadi|therefore|thus|so that|so )\b/i.test(trimmed);
  const hasSolution =
    /\b(solusi|solution|fix|resolved by|to address this|implemented by)\b/i.test(
      trimmed,
    );

  let nextValue = trimmed;
  if (!hasEffect) {
    nextValue = `${nextValue}, sehingga dampak perubahan dan konteks masalahnya menjadi lebih jelas.`;
  }

  if (!hasSolution) {
    nextValue = `${nextValue} Solusi: perubahan ini menyesuaikan implementasi agar masalah yang dibahas dapat ditangani.`;
  }

  return nextValue;
}

export function HistorySnapshotViewer({
  snapshot,
  payload,
  initialSummaryArtifacts,
}: {
  snapshot: SnapshotRecord;
  payload: HistoricalExportPayload;
  initialSummaryArtifacts: SnapshotSummaryArtifacts;
}) {
  const [summaryArtifacts, setSummaryArtifacts] = useState(
    initialSummaryArtifacts,
  );
  const [openAiApiKey, setOpenAiApiKey] = useState("");
  const [summaryModel, setSummaryModel] = useState(
    initialSummaryArtifacts.index?.model || "gpt-5-mini",
  );
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [summaryStatus, setSummaryStatus] = useState("");
  const datasetMetrics = calculateDatasetMetrics(payload);
  const generatedIssueCount = summaryArtifacts.index?.issues.length || 0;
  const latestAst = summaryArtifacts.ast;
  const hasSavedSummaries = generatedIssueCount > 0;
  const issueMetricsMap = new Map(
    payload.issues.map((issue) => [issue.issueNumber, calculateIssueMetrics(issue)]),
  );

  const handleGenerateSummaries = async () => {
    setSummaryLoading(true);
    setSummaryError("");
    setSummaryStatus(
      "Generating markdown summaries and rationale-linked AST...",
    );

    try {
      const nextArtifacts = await GitHubHistoryApi.generateSnapshotSummaries({
        snapshotId: snapshot.id,
        apiKey: openAiApiKey || undefined,
        model: summaryModel,
      });

      setSummaryArtifacts({
        index: nextArtifacts.index,
        ast: nextArtifacts.ast,
      });
      setSummaryModel(nextArtifacts.defaultModel || summaryModel);
      setSummaryStatus(
        "Summary generation completed and saved into this snapshot.",
      );
    } catch (error) {
      setSummaryError(
        error instanceof Error
          ? error.message
          : "Failed to generate standardized summaries",
      );
      setSummaryStatus("");
    } finally {
      setSummaryLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              History Snapshot
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950">
              {snapshot.repoName}
            </h1>
          </div>
          <div className="grid gap-2 text-sm text-slate-600">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              Requested branch:{" "}
              <span className="font-medium">{snapshot.requestedBranchRef}</span>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              Stored branch:{" "}
              <span className="font-medium">{snapshot.storedBranchRef}</span>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              Created:{" "}
              <span className="font-medium">
                {new Date(snapshot.createdAt).toLocaleString("id-ID")}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              PR Stories
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">
              {payload.issues.length}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Discussion Items
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">
              {datasetMetrics.discussionCount}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Commits
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">
              {datasetMetrics.commitCount}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Files Changed
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">
              {datasetMetrics.fileChangedCount}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Code Changes
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">
              {datasetMetrics.codeChangeCount}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2 xl:col-span-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Standardized Summary
                </p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">
                  {generatedIssueCount}/{payload.issues.length}
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  {hasSavedSummaries
                    ? "Summary markdown dan AST rationale sudah dimuat dari file snapshot yang tersimpan."
                    : "Generate markdown summary per issue from `docs/pr-sum-standard/template.txt`, lalu simpan juga `ast-with-rationale.json` untuk Tree-Mapping dan Repo Viewer."}
                </p>
                {latestAst ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Last generated:{" "}
                    {new Date(latestAst.generatedAt).toLocaleString("id-ID")}
                  </p>
                ) : null}
              </div>

              {hasSavedSummaries ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                  Snapshot ini sudah punya summary tersimpan. Halaman akan langsung memakai file hasil generate sebelumnya tanpa perlu generate ulang.
                </div>
              ) : null}
            </div>

            <p className="mt-3 text-xs text-slate-500">
              Default model is `gpt-5-mini` for lower cost. The generator uses
              the Responses API and structured JSON, then renders markdown
              locally to save output tokens. By default the server uses
              `OPENAI_API_KEY` from `.env.local`.
            </p>

            <LazyDetails
              className="mt-3 rounded-2xl border border-slate-200 bg-white p-4"
              summary={
                <span className="text-sm font-medium text-slate-800">
                  {hasSavedSummaries
                    ? "Regenerate saved summaries"
                    : "Generate summaries for this snapshot"}
                </span>
              }
            >
              <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_200px_auto]">
                <input
                  type="password"
                  value={openAiApiKey}
                  onChange={(event) => setOpenAiApiKey(event.target.value)}
                  placeholder="Optional override API key for this request"
                  className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
                />
                <input
                  type="text"
                  value={summaryModel}
                  onChange={(event) => setSummaryModel(event.target.value)}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
                />
                <button
                  onClick={() => void handleGenerateSummaries()}
                  disabled={summaryLoading}
                  className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {summaryLoading
                    ? "Generating..."
                    : hasSavedSummaries
                      ? "Regenerate Summaries"
                      : "Generate Summaries"}
                </button>
              </div>
            </LazyDetails>

            {summaryStatus ? (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                {summaryStatus}
              </div>
            ) : null}
            {summaryError ? (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                {summaryError}
              </div>
            ) : null}

            {summaryArtifacts.index?.issues.length ? (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Saved Summaries
                  </p>
                  <p className="text-xs text-slate-500">
                    Rendered from stored markdown files
                  </p>
                </div>

                <div className="space-y-3">
                  {summaryArtifacts.index.issues.map((issueSummary) => (
                    <LazyDetails
                      key={issueSummary.issueNumber}
                      className="rounded-2xl border border-slate-200 bg-white p-4"
                      summary={
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-slate-950">
                              #{issueSummary.issueNumber} {issueSummary.title}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {issueSummary.whatChanged.length} change items •{" "}
                              {issueSummary.model}
                            </p>
                            {issueMetricsMap.get(issueSummary.issueNumber) ? (
                              <p className="mt-1 text-xs text-slate-500">
                                {issueMetricsMap.get(issueSummary.issueNumber)!
                                  .discussionCount}{" "}
                                diskusi •{" "}
                                {issueMetricsMap.get(issueSummary.issueNumber)!
                                  .commitCount}{" "}
                                commit •{" "}
                                {issueMetricsMap.get(issueSummary.issueNumber)!
                                  .fileChangedCount}{" "}
                                file changed
                              </p>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {issueSummary.changeSize ? (
                              <div
                                className={`rounded-full border px-3 py-1 text-xs font-medium ${changeSizeTone(issueSummary.changeSize.level)}`}
                              >
                                Perubahan {issueSummary.changeSize.level}
                              </div>
                            ) : null}
                            <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                              {new Date(issueSummary.generatedAt).toLocaleString(
                                "id-ID",
                              )}
                            </div>
                          </div>
                        </div>
                      }
                    >
                      {issueSummary.changeSize ? (
                        <div
                          className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${changeSizeTone(issueSummary.changeSize.level)}`}
                        >
                          <span className="font-semibold">
                            Klasifikasi perubahan:{" "}
                            {issueSummary.changeSize.level}
                          </span>{" "}
                          <span>{ensureStructuredRationale(issueSummary.changeSize.rationale)}</span>
                        </div>
                      ) : null}

                      {issueSummary.changeContrast?.length ? (
                        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                            <thead className="bg-slate-50 text-slate-600">
                              <tr>
                                <th className="px-4 py-3 font-semibold">
                                  Aspek
                                </th>
                                <th className="px-4 py-3 font-semibold">
                                  Sebelum
                                </th>
                                <th className="px-4 py-3 font-semibold">
                                  Sesudah
                                </th>
                                <th className="px-4 py-3 font-semibold">
                                  Rationale
                                </th>
                                <th className="px-4 py-3 font-semibold">
                                  Evidence
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 text-slate-700">
                              {issueSummary.changeContrast.map((entry, index) => (
                                <tr
                                  key={`${issueSummary.issueNumber}-${entry.aspect}-${index}`}
                                  className="align-top"
                                >
                                  <td className="px-4 py-3">
                                    <div className="font-semibold capitalize text-slate-900">
                                      {entry.aspect}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 leading-6">
                                    {entry.before}
                                  </td>
                                  <td className="px-4 py-3 leading-6">
                                    {entry.after}
                                  </td>
                                  <td className="px-4 py-3 leading-6">
                                    {ensureStructuredRationale(
                                      entry.rationale || entry.reason || "-",
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-xs leading-5 text-slate-500">
                                    <div>{entry.evidenceSource}</div>
                                    <div className="mt-1">
                                      refs:{" "}
                                      {entry.evidenceRefs.join(", ") || "-"}
                                    </div>
                                    <div className="mt-1">
                                      commits:{" "}
                                      {entry.relatedCommitIds.join(", ") || "-"}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}

                      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <MarkdownBody body={issueSummary.markdown} />
                      </div>
                    </LazyDetails>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <HistorySnapshotWorkspace
        snapshot={snapshot}
        payload={payload}
        summaryArtifacts={summaryArtifacts}
      />

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Raw JSON
          </p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">
            Keep the original export nearby
          </h2>
        </div>

        <LazyDetails
          className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
          summary={
            <span className="text-sm font-medium text-slate-800">
              Show raw history JSON
            </span>
          }
        >
          <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </LazyDetails>

        {summaryArtifacts.ast ? (
          <LazyDetails
            className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4"
            summary={
              <span className="text-sm font-medium text-slate-800">
                Show saved AST with rationale
              </span>
            }
          >
            <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
              {JSON.stringify(summaryArtifacts.ast, null, 2)}
            </pre>
          </LazyDetails>
        ) : null}
      </section>
    </div>
  );
}
