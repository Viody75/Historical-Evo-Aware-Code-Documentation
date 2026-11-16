"use client";

import { useEffect, useState } from "react";

import { LazyDetails } from "@/app/history-viewer/components/LazyDetails";
import { GitHubHistoryApi } from "@/app/history-viewer/lib/GitHubHistoryApi";
import type {
  QuantitativeMetricValues,
  SnapshotQuantitativeTestingArtifact,
} from "@/app/history-viewer/types";

function formatMetric(value: number | null | undefined) {
  return typeof value === "number" ? value.toFixed(4) : "—";
}

function MetricCard({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: "slate" | "sky" | "emerald" | "violet" | "amber";
}) {
  const tones = {
    slate: "border-slate-200 bg-slate-50 text-slate-950",
    sky: "border-sky-200 bg-sky-50 text-sky-950",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-950",
    violet: "border-violet-200 bg-violet-50 text-violet-950",
    amber: "border-amber-200 bg-amber-50 text-amber-950",
  };

  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <p className="text-[11px] font-bold uppercase tracking-[0.15em] opacity-65">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function SimilarityMetricCards({ values }: { values: QuantitativeMetricValues }) {
  return (
    <>
      <MetricCard label="Precision" value={formatMetric(values.precision)} tone="sky" />
      <MetricCard label="Recall" value={formatMetric(values.recall)} tone="violet" />
      <MetricCard label="F1" value={formatMetric(values.f1)} tone="emerald" />
    </>
  );
}

export function QuantitativeTestingPanel({ snapshotId }: { snapshotId: string }) {
  const [artifact, setArtifact] =
    useState<SnapshotQuantitativeTestingArtifact | null>(null);
  const [groundTruthText, setGroundTruthText] = useState("");
  const [loadedGroundTruthText, setLoadedGroundTruthText] = useState("");
  const [generatedComparisonText, setGeneratedComparisonText] = useState("");
  const [loadedGeneratedComparisonText, setLoadedGeneratedComparisonText] =
    useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let active = true;

    void GitHubHistoryApi.fetchSnapshotQuantitativeTesting(snapshotId)
      .then((nextArtifact) => {
        if (!active) {
          return;
        }
        const renderedGroundTruth = JSON.stringify(
          nextArtifact.groundTruth,
          null,
          2,
        );
        const renderedGeneratedComparison = JSON.stringify(
          nextArtifact.generatedComparison,
          null,
          2,
        );
        setArtifact(nextArtifact);
        setGroundTruthText(renderedGroundTruth);
        setLoadedGroundTruthText(renderedGroundTruth);
        setGeneratedComparisonText(renderedGeneratedComparison);
        setLoadedGeneratedComparisonText(renderedGeneratedComparison);
      })
      .catch((loadError) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load quantitative testing state",
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [snapshotId]);

  const formatGroundTruth = () => {
    try {
      const parsed = JSON.parse(groundTruthText) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Ground truth must be a JSON object");
      }
      setGroundTruthText(JSON.stringify(parsed, null, 2));
      setError("");
    } catch (formatError) {
      setError(
        formatError instanceof Error
          ? `Invalid ground truth JSON: ${formatError.message}`
          : "Invalid ground truth JSON",
      );
    }
  };

  const formatGeneratedComparison = () => {
    try {
      const parsed = JSON.parse(generatedComparisonText) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Generated comparison must be a JSON object");
      }
      setGeneratedComparisonText(JSON.stringify(parsed, null, 2));
      setError("");
    } catch (formatError) {
      setError(
        formatError instanceof Error
          ? `Invalid generated comparison JSON: ${formatError.message}`
          : "Invalid generated comparison JSON",
      );
    }
  };

  const runEvaluation = async () => {
    setError("");
    setStatus("");

    let groundTruth: Record<string, unknown>;
    let generatedComparison: Record<string, unknown>;
    try {
      const parsed = JSON.parse(groundTruthText) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Ground truth must be a JSON object");
      }
      groundTruth = parsed as Record<string, unknown>;
    } catch (parseError) {
      setError(
        parseError instanceof Error
          ? `Invalid ground truth JSON: ${parseError.message}`
          : "Invalid ground truth JSON",
      );
      return;
    }

    try {
      const parsed = JSON.parse(generatedComparisonText) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Generated comparison must be a JSON object");
      }
      generatedComparison = parsed as Record<string, unknown>;
    } catch (parseError) {
      setError(
        parseError instanceof Error
          ? `Invalid generated comparison JSON: ${parseError.message}`
          : "Invalid generated comparison JSON",
      );
      return;
    }

    setRunning(true);
    setStatus(
      "Running similarity scoring with the edited evaluation inputs...",
    );
    try {
      const nextArtifact = await GitHubHistoryApi.runSnapshotQuantitativeTesting({
        snapshotId,
        groundTruth,
        generatedComparison,
      });
      const renderedGroundTruth = JSON.stringify(
        nextArtifact.groundTruth,
        null,
        2,
      );
      const renderedGeneratedComparison = JSON.stringify(
        nextArtifact.generatedComparison,
        null,
        2,
      );
      setArtifact(nextArtifact);
      setGroundTruthText(renderedGroundTruth);
      setLoadedGroundTruthText(renderedGroundTruth);
      setGeneratedComparisonText(renderedGeneratedComparison);
      setLoadedGeneratedComparisonText(renderedGeneratedComparison);
      setStatus("Quantitative testing completed and its artifacts were saved.");
    } catch (runError) {
      setError(
        runError instanceof Error
          ? runError.message
          : "Failed to run quantitative testing",
      );
      setStatus("");
    } finally {
      setRunning(false);
    }
  };

  const aggregate = artifact?.metrics?.aggregate;
  const engine = artifact?.metrics?.metricEngine;

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Quantitative Testing
          </p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">
            Compare generated rationale with the GitHub evidence reference
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Review or normalize both JSON inputs, then run BERTScore to measure
            semantic similarity between the generated rationale and the silver
            ground truth derived from GitHub.
          </p>
        </div>

        <div>
          <button
            type="button"
            disabled={loading || running || !artifact}
            onClick={() => void runEvaluation()}
            className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? "Testing..." : "Run Quantitative Testing"}
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
        <span className="font-semibold">Evaluation inputs:</span> the ground
        truth is an automatically extracted GitHub evidence reference. Editing
        is available for correction and cross-tool format normalization; record
        any content changes so the experiment remains reproducible.
      </div>

      {loading ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
          Loading evaluation draft and previous results...
        </div>
      ) : null}

      {status ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {status}
        </div>
      ) : null}
      {error ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm whitespace-pre-wrap text-rose-900">
          {error}
        </div>
      ) : null}

      {aggregate && engine ? (
        <div className="mt-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
              {engine.name}
            </span>
            <span className="text-xs text-slate-500">
              {artifact?.generatedAt
                ? `Last run ${new Date(artifact.generatedAt).toLocaleString("id-ID")}`
                : "Not run yet"}
            </span>
          </div>
          {engine.fallback ? (
            <p className="mt-2 text-xs leading-5 text-amber-700">
              BERTScore dependency is unavailable, so this run used exact token
              overlap. Install <code>requirements-evaluation.txt</code> and run
              again for semantic BERTScore.
            </p>
          ) : null}

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Issues"
              value={String(aggregate.issueCount)}
            />
            <SimilarityMetricCards values={aggregate.similarityScoreMacro} />
          </div>
        </div>
      ) : null}

      {artifact ? (
        <div className="mt-5 space-y-3">
          <LazyDetails
            defaultOpen={!artifact.metrics}
            className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
            summary={
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Silver Ground Truth JSON
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Editable JSON; saved when the testing pipeline runs
                </p>
              </div>
            }
          >
            <textarea
              value={groundTruthText}
              onChange={(event) => setGroundTruthText(event.target.value)}
              spellCheck={false}
              className="mt-4 min-h-[520px] w-full resize-y rounded-xl bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-100 outline-none focus:ring-2 focus:ring-sky-400"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={formatGroundTruth}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Format JSON
              </button>
              <button
                type="button"
                onClick={() => {
                  setGroundTruthText(loadedGroundTruthText);
                  setError("");
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Reset unsaved edits
              </button>
            </div>
          </LazyDetails>

          <LazyDetails
            className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
            summary={
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Generated comparison JSON
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Editable input; evaluated and saved when the pipeline runs
                </p>
              </div>
            }
          >
            <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-900">
              The evaluator uses <code>issues[].generatedClaims[].text</code> as
              the candidate rationale. Keep claim IDs unique for traceability
              across evaluation artifacts.
            </div>
            <textarea
              value={generatedComparisonText}
              onChange={(event) =>
                setGeneratedComparisonText(event.target.value)
              }
              spellCheck={false}
              className="mt-4 min-h-[520px] w-full resize-y rounded-xl bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-100 outline-none focus:ring-2 focus:ring-sky-400"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={formatGeneratedComparison}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Format JSON
              </button>
              <button
                type="button"
                onClick={() => {
                  setGeneratedComparisonText(loadedGeneratedComparisonText);
                  setError("");
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Reset unsaved edits
              </button>
            </div>
          </LazyDetails>

          {artifact.metrics ? (
            <LazyDetails
              className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
              summary={
                <span className="text-sm font-semibold text-slate-900">
                  Raw metrics JSON
                </span>
              }
            >
              <pre className="mt-4 max-h-[620px] overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                {JSON.stringify(artifact.metrics, null, 2)}
              </pre>
            </LazyDetails>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
