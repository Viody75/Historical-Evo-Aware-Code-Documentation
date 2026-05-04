import { HistorySnapshotWorkspace } from "@/app/history-viewer/components/HistorySnapshotWorkspace";
import type {
  HistoricalExportPayload,
  SnapshotRecord,
} from "@/app/history-viewer/types";

function countCodeChanges(payload: HistoricalExportPayload) {
  return payload.issues.reduce(
    (total, issue) =>
      total +
      issue.commits.reduce(
        (commitTotal, commit) => commitTotal + commit.codeChanges.length,
        0,
      ),
    0,
  );
}

export function HistorySnapshotViewer({
  snapshot,
  payload,
}: {
  snapshot: SnapshotRecord;
  payload: HistoricalExportPayload;
}) {
  const totalDiscussion = payload.issues.reduce(
    (total, issue) => total + issue.discussion.length,
    0,
  );
  const totalCommits = payload.issues.reduce(
    (total, issue) => total + issue.commits.length,
    0,
  );
  const totalCodeChanges = countCodeChanges(payload);

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
              {totalDiscussion}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Commits
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">
              {totalCommits}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Code Changes
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">
              {totalCodeChanges}
            </p>
          </div>
        </div>
      </section>

      <HistorySnapshotWorkspace snapshot={snapshot} payload={payload} />

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Raw JSON
          </p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">
            Keep the original export nearby
          </h2>
        </div>

        <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <summary className="cursor-pointer list-none text-sm font-medium text-slate-800">
            Show raw history JSON
          </summary>
          <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </details>
      </section>
    </div>
  );
}
