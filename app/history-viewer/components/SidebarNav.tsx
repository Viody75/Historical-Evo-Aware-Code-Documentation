import { PanelIcon } from "@/app/history-viewer/components/PanelIcon";

export function SidebarNav({
  onHide,
}: {
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
        <div className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-left">
          <p className="flex items-center gap-2 text-sm font-medium text-white">
            <PanelIcon name="git" />
            Issue Journey
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Pull requests, discussions, commits, and change patches.
          </p>
        </div>
      </nav>

      <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Current Scope
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          This workspace focuses on code evolution reconstructed from issues,
          discussions, commits, code changes, and comparison references.
        </p>
      </div>
    </aside>
  );
}
