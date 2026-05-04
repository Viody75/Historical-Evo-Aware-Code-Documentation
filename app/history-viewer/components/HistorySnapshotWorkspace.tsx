"use client";

import { useState } from "react";

import { HistoryCollapsibleTree } from "@/app/history-viewer/components/HistoryCollapsibleTree";
import { SnapshotRepoViewer } from "@/app/history-viewer/components/SnapshotRepoViewer";
import type {
  HistoricalExportPayload,
  SnapshotNavigationTarget,
  SnapshotRecord,
} from "@/app/history-viewer/types";

export function HistorySnapshotWorkspace({
  snapshot,
  payload,
}: {
  snapshot: SnapshotRecord;
  payload: HistoricalExportPayload;
}) {
  const [navigationTarget, setNavigationTarget] =
    useState<SnapshotNavigationTarget | null>(null);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            JSON Viewer
          </p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">
            Tree-Mapping for browsing history JSON
          </h2>
        </div>

        <HistoryCollapsibleTree
          payload={payload}
          onNavigateTarget={setNavigationTarget}
        />
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Repo Viewer
          </p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">
            Current snapshot code with historical trail
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Viewer ini membaca repo hasil clone dari snapshot, lalu
            menghubungkannya dengan commit, author, dan issue yang tercatat di
            exported history.
          </p>
        </div>

        <SnapshotRepoViewer
          snapshot={snapshot}
          payload={payload}
          navigationTarget={navigationTarget}
        />
      </section>
    </div>
  );
}
