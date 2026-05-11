import Link from "next/link";
import { notFound } from "next/navigation";

import { HistorySnapshotViewer } from "@/app/history-viewer/components/HistorySnapshotViewer";
import { SnapshotWorkspaceStore } from "@/app/history-viewer/server/SnapshotWorkspaceStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const snapshotStore = new SnapshotWorkspaceStore();

export default async function SnapshotDetailPage({
  params,
}: {
  params: Promise<{ snapshotId: string }>;
}) {
  const { snapshotId } = await params;
  const [snapshot, payload, initialSummaryArtifacts] = await Promise.all([
    snapshotStore.getSnapshotById(snapshotId),
    snapshotStore.getSnapshotHistory(snapshotId),
    snapshotStore.getSnapshotSummaryArtifacts(snapshotId),
  ]);

  if (!snapshot || !payload) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-950 md:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Snapshot Detail
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950">
              Repository history workspace
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Tempat untuk menjelajahi snapshot sejarah repository dengan
              menyatukan diskusi, commit, dan code changes untuk memahami
              evolusi keputusan di repository.
            </p>
          </div>

          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-xl bg-slate-200 px-4 py-3 text-sm font-medium text-slate-900 hover:bg-slate-300"
          >
            Back to Issue Journey
          </Link>
        </div>

        <HistorySnapshotViewer
          snapshot={snapshot}
          payload={payload}
          initialSummaryArtifacts={initialSummaryArtifacts}
        />
      </div>
    </main>
  );
}
