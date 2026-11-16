import { EvolutionTimelineViewer } from "@/app/history-viewer/components/EvolutionTimelineViewer";
import type {
  HistoricalExportPayload,
  SnapshotSummaryArtifacts,
} from "@/app/history-viewer/types";

export function HistorySnapshotWorkspace({
  payload,
  summaryArtifacts,
}: {
  payload: HistoricalExportPayload;
  summaryArtifacts: SnapshotSummaryArtifacts;
}) {
  return (
    <div>
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Evolution Timeline
          </p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">
            Follow discussions, rationale, commits, and code over time
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Timeline horizontal ini menyusun perjalanan kode dari PR lama ke
            PR terbaru. Setiap PR mengelompokkan narasi diskusi, commit,
            tanggal, generated rationale, significance flag, dan patch yang
            berubah.
          </p>
        </div>

        <EvolutionTimelineViewer
          payload={payload}
          summaryIndex={summaryArtifacts.index}
        />
      </section>
    </div>
  );
}
