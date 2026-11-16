"use client";

import { useId, useState } from "react";

import {
  EvidenceReferenceLink,
  EvidenceReferenceLinks,
} from "@/app/history-viewer/components/EvidenceReferenceLinks";
import type {
  HistoricalExportPayload,
  SummaryDiscussionNarrative,
} from "@/app/history-viewer/types";

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function DiscussionNarrativeCard({
  item,
  index,
  payload,
  issueNumber,
}: {
  item: SummaryDiscussionNarrative;
  index: number;
  payload: HistoricalExportPayload;
  issueNumber: number;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const generatedId = useId();
  const participants = uniqueNonEmpty(item.participants || []);
  const relatedCommitIds = uniqueNonEmpty(item.relatedCommitIds || []);
  const evidenceRefs = uniqueNonEmpty(item.evidenceRefs || []);
  const detailsId = `discussion-thread-${generatedId}-details`;

  return (
    <article className="overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-sm">
      <header className="border-b border-violet-100 bg-violet-50 px-4 py-3">
        <p className="text-sm font-semibold text-violet-950">
          Thread {String(index + 1).padStart(2, "0")}
        </p>
      </header>

      <div className="p-4">
        <section>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
            Narrative
          </p>
          <p
            className={`mt-1.5 text-sm leading-6 text-slate-700 ${
              isExpanded ? "" : "line-clamp-2"
            }`}
          >
            {item.narrative}
          </p>
        </section>

        <div
          id={detailsId}
          hidden={!isExpanded}
          className="mt-4 space-y-4 border-t border-slate-100 pt-4"
        >
          {isExpanded ? (
            <>
              <section className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700">
                  Outcome
                </p>
                <p className="mt-1 text-sm leading-6 text-emerald-950">
                  {item.outcome}
                </p>
              </section>

              <div className="grid gap-3 sm:grid-cols-2">
                <section>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    Participants
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {participants.length > 0 ? (
                      participants.map((participant) => (
                        <span
                          key={participant}
                          className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-800"
                        >
                          @{participant.replace(/^@/, "")}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-slate-400">
                        Not identified
                      </span>
                    )}
                  </div>
                </section>

                <section>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    Related commits
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {relatedCommitIds.length > 0 ? (
                      relatedCommitIds.map((commitId) => (
                        <EvidenceReferenceLink
                          key={commitId}
                          reference={`commit:${commitId}`}
                          payload={payload}
                          issueNumber={issueNumber}
                        >
                          {commitId.slice(0, 12)}
                        </EvidenceReferenceLink>
                      ))
                    ) : (
                      <span className="text-xs text-slate-400">
                        PR-level discussion
                      </span>
                    )}
                  </div>
                </section>
              </div>

              <section>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Evidence
                </p>
                <div className="mt-2">
                  <EvidenceReferenceLinks
                    references={evidenceRefs}
                    payload={payload}
                    issueNumber={issueNumber}
                  />
                </div>
              </section>
            </>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setIsExpanded((current) => !current)}
          aria-expanded={isExpanded}
          aria-controls={detailsId}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700 transition hover:border-violet-300 hover:bg-violet-100"
        >
          {isExpanded ? "Show less" : "Inspect more"}
          <span aria-hidden="true">{isExpanded ? "−" : "+"}</span>
        </button>
      </div>
    </article>
  );
}

export function DiscussionNarrativeCards({
  narratives,
  payload,
  issueNumber,
  compact = false,
  emptyMessage = "No substantive GitHub discussion was captured for this change.",
}: {
  narratives: SummaryDiscussionNarrative[];
  payload: HistoricalExportPayload;
  issueNumber: number;
  compact?: boolean;
  emptyMessage?: string;
}) {
  if (narratives.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={`grid gap-4 ${compact ? "grid-cols-1" : "lg:grid-cols-2"}`}>
      {narratives.map((item, index) => (
        <DiscussionNarrativeCard
          key={`${item.evidenceRefs?.[0] || item.narrative}-${index}`}
          item={item}
          index={index}
          payload={payload}
          issueNumber={issueNumber}
        />
      ))}
    </div>
  );
}
