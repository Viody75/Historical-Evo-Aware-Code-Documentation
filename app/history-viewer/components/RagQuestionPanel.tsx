"use client";

import { useState } from "react";

import { LazyDetails } from "@/app/history-viewer/components/LazyDetails";
import { MarkdownBody } from "@/app/history-viewer/components/MarkdownBody";
import { GitHubHistoryApi } from "@/app/history-viewer/lib/GitHubHistoryApi";
import type {
  RagQueryResult,
  SnapshotRecord,
} from "@/app/history-viewer/types";

function scoreLabel(score: number) {
  return Number.isFinite(score) ? score.toFixed(4) : "-";
}

export function RagQuestionPanel({ snapshot }: { snapshot: SnapshotRecord }) {
  const [question, setQuestion] = useState("");
  const [model, setModel] = useState("gpt-5-mini");
  const [apiKey, setApiKey] = useState("");
  const [ingestionSecret, setIngestionSecret] = useState("");
  const [retrieveOnly, setRetrieveOnly] = useState(false);
  const [result, setResult] = useState<RagQueryResult | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [indexLoading, setIndexLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const handleIndex = async () => {
    setIndexLoading(true);
    setStatus("Indexing snapshot history into PostgreSQL...");
    setError("");

    try {
      const response = await GitHubHistoryApi.indexSnapshotForRag({
        snapshotId: snapshot.id,
        ingestionSecret: ingestionSecret || undefined,
      });
      setStatus(
        `RAG index is ready with ${response.indexedDocuments} document chunks.`,
      );
    } catch (indexError) {
      setStatus("");
      setError(
        indexError instanceof Error
          ? indexError.message
          : "Failed to index this snapshot",
      );
    } finally {
      setIndexLoading(false);
    }
  };

  const handleQuery = async () => {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion) {
      setError("Enter a question about this repository snapshot.");
      return;
    }

    setQueryLoading(true);
    setStatus(
      retrieveOnly
        ? "Retrieving relevant history documents..."
        : "Retrieving evidence and generating an answer...",
    );
    setError("");

    try {
      const response = await GitHubHistoryApi.queryRag({
        repo: snapshot.repoName,
        snapshotId: snapshot.id,
        question: normalizedQuestion,
        limit: 6,
        apiKey: apiKey || undefined,
        model,
        retrieveOnly,
      });
      setResult(response);
      setModel(response.defaultModel || model);
      setStatus(
        `Retrieved ${response.retrievedDocuments.length} document(s) using ${response.retrievalMethod}.`,
      );
    } catch (queryError) {
      setStatus("");
      setError(
        queryError instanceof Error ? queryError.message : "RAG query failed",
      );
    } finally {
      setQueryLoading(false);
    }
  };

  const citedDocuments = new Map(
    (result?.retrievedDocuments || []).map((document) => [document.id, document]),
  );

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Retrieval-Augmented Generation
          </p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">
            Ask this repository history
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Pertanyaan dicari terlebih dahulu pada chunk issue, discussion,
            commit, patch, dan generated summary di PostgreSQL. Hanya evidence
            hasil retrieval yang dikirim ke model untuk menyusun jawaban.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleIndex()}
          disabled={indexLoading}
          className="rounded-xl bg-slate-200 px-4 py-3 text-sm font-medium text-slate-900 hover:bg-slate-300 disabled:opacity-50"
        >
          {indexLoading ? "Indexing..." : "Index current snapshot"}
        </button>
      </div>

      <div className="mt-5 space-y-3">
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          rows={3}
          placeholder="Contoh: Mengapa struktur ingestion diubah dan file apa saja yang terlibat?"
          className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
        />

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={retrieveOnly}
              onChange={(event) => setRetrieveOnly(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Retrieve only (tanpa memanggil LLM)
          </label>
          <button
            type="button"
            onClick={() => void handleQuery()}
            disabled={queryLoading}
            className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {queryLoading
              ? retrieveOnly
                ? "Retrieving..."
                : "Generating..."
              : retrieveOnly
                ? "Retrieve evidence"
                : "Ask with RAG"}
          </button>
        </div>

        <LazyDetails
          className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
          summary={
            <span className="text-sm font-medium text-slate-800">
              Advanced settings
            </span>
          }
        >
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <input
              type="text"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="Model"
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
            />
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Optional OpenAI API key override"
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
            />
            <input
              type="password"
              value={ingestionSecret}
              onChange={(event) => setIngestionSecret(event.target.value)}
              placeholder="Ingestion secret for indexing"
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
            />
          </div>
        </LazyDetails>
      </div>

      {status ? (
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          {status}
        </div>
      ) : null}
      {error ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="mt-5 space-y-4">
          {result.answer ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">
                Grounded answer
              </p>
              <div className="mt-3 text-sm text-slate-900">
                <MarkdownBody body={result.answer} />
              </div>
            </div>
          ) : null}

          {result.citations.length > 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Citations
              </p>
              <div className="mt-3 space-y-3">
                {result.citations.map((citation, index) => {
                  const document = citedDocuments.get(citation.documentId);
                  return (
                    <div
                      key={`${citation.documentId}-${index}`}
                      className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                    >
                      <p className="text-sm font-medium text-slate-900">
                        {document?.title || citation.documentId}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        {citation.claim}
                      </p>
                      <p className="mt-2 break-all text-xs text-slate-500">
                        {citation.documentId}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Retrieved evidence
            </p>
            <div className="mt-3 space-y-3">
              {result.retrievedDocuments.map((document) => (
                <LazyDetails
                  key={document.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                  summary={
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {document.title}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {document.kind} • score {scoreLabel(document.score)}
                        </p>
                      </div>
                      <span className="rounded-full bg-white px-3 py-1 text-xs text-slate-600">
                        {document.evidenceRefs.join(", ") || "no evidence ref"}
                      </span>
                    </div>
                  }
                >
                  <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                    {document.excerpt}
                  </pre>
                </LazyDetails>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
