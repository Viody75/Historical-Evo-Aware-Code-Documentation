import { PanelIcon } from "@/app/history-viewer/components/PanelIcon";
import type { WorkspaceView } from "@/app/history-viewer/types";

export function SidebarNav({
  activeView,
  onChangeView,
  onHide,
}: {
  activeView: WorkspaceView;
  onChangeView: (view: WorkspaceView) => void;
  onHide: () => void;
}) {
  return (
    <aside className="w-full border-b border-slate-800 bg-slate-950 px-6 py-6 text-slate-100 lg:w-64 lg:border-b-0 lg:border-r">
      <div className="mb-4 flex justify-end lg:mb-6">
        <button
          onClick={onHide}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
        >
          <PanelIcon name="sidebar" />
          Hide sidebar
        </button>
      </div>

      <nav className="space-y-3">
        <button
          onClick={() => onChangeView("issue-journey")}
          className={`w-full rounded-2xl border px-4 py-3 text-left ${
            activeView === "issue-journey"
              ? "border-slate-700 bg-slate-900"
              : "border-slate-800 bg-slate-950 hover:bg-slate-900/70"
          }`}
        >
          <p className="flex items-center gap-2 text-sm font-medium text-white">
            <PanelIcon name="git" />
            Issue Journey
          </p>
          <p className="mt-1 text-xs text-slate-400">
            PR, diskusi, commit, dan patch perubahan.
          </p>
        </button>
        <button
          onClick={() => onChangeView("comparator")}
          className={`w-full rounded-2xl border px-4 py-3 text-left ${
            activeView === "comparator"
              ? "border-slate-700 bg-slate-900"
              : "border-slate-800 bg-slate-950 hover:bg-slate-900/70"
          }`}
        >
          <p className="flex items-center gap-2 text-sm font-medium text-white">
            <PanelIcon name="compare" />
            Comparator
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Compare branch atau commit secara fleksibel dalam repo aktif.
          </p>
        </button>
      </nav>

      <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Current Scope
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Workspace ini fokus ke evolusi kode yang bisa direkonstruksi dari
          issue, diskusi, commit, code changes, dan compare refs.
        </p>
      </div>
    </aside>
  );
}
