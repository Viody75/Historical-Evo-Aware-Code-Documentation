import { FileTreeBuilder, DiffParser } from "@/app/history-viewer/lib/comparator";
import { PanelIcon } from "@/app/history-viewer/components/PanelIcon";
import type { PullRequestFile } from "@/app/history-viewer/types";

export function ComparatorViewer({
  title,
  subtitle,
  files,
  selectedFile,
  onSelectFile,
  badge,
}: {
  title: string;
  subtitle: string;
  files: PullRequestFile[];
  selectedFile?: PullRequestFile;
  onSelectFile: (filename: string) => void;
  badge: string;
}) {
  if (files.length === 0) {
    return null;
  }

  const diffRows = selectedFile ? DiffParser.parsePatchRows(selectedFile.patch) : [];
  const fileTree = FileTreeBuilder.build(files);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              <PanelIcon name="compare" />
              Comparator
            </p>
            <h4 className="mt-1 text-lg font-semibold text-slate-950">{title}</h4>
            <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
          </div>
          <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
            {badge}
          </div>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="border-b border-slate-200 bg-slate-50 lg:border-b-0 lg:border-r">
          <div className="border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Files
          </div>
          <div className="max-h-[560px] overflow-y-auto py-2">
            {FileTreeBuilder.render(
              fileTree,
              selectedFile?.filename,
              onSelectFile,
              () => <PanelIcon name="folder" />,
              () => <PanelIcon name="file" />,
            )}
          </div>
        </div>

        <div className="min-w-0">
          {selectedFile ? (
            <>
              <div className="border-b border-slate-200 px-4 py-3">
                <p className="text-sm font-medium text-slate-900">
                  {selectedFile.filename}
                </p>
              </div>
              <div className="grid grid-cols-2 border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                <div className="border-r border-slate-200 px-4 py-2">Before</div>
                <div className="px-4 py-2">After</div>
              </div>
              <div className="max-h-[560px] overflow-auto">
                {selectedFile.patch ? (
                  diffRows.map((row, index) => (
                    <div
                      key={`${selectedFile.filename}-${index}`}
                      className="grid grid-cols-2 border-b border-slate-100 font-mono text-xs"
                    >
                      <div
                        className={`grid grid-cols-[56px_minmax(0,1fr)] border-r border-slate-200 ${DiffParser.getPaneClass(
                          row.kind,
                          "before",
                          row.beforeLineNumber !== null || row.beforeText.length > 0,
                        )}`}
                      >
                        <span className="border-r border-slate-200 px-3 py-1 text-right text-slate-400">
                          {row.beforeLineNumber ?? ""}
                        </span>
                        <pre className="overflow-x-auto px-3 py-1 whitespace-pre-wrap">
                          {row.beforeText || " "}
                        </pre>
                      </div>
                      <div
                        className={`grid grid-cols-[56px_minmax(0,1fr)] ${DiffParser.getPaneClass(
                          row.kind,
                          "after",
                          row.afterLineNumber !== null || row.afterText.length > 0,
                        )}`}
                      >
                        <span className="border-r border-slate-200 px-3 py-1 text-right text-slate-400">
                          {row.afterLineNumber ?? ""}
                        </span>
                        <pre className="overflow-x-auto px-3 py-1 whitespace-pre-wrap">
                          {row.afterText || " "}
                        </pre>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-4 py-6 text-sm text-slate-500">
                    GitHub tidak menyertakan patch untuk file ini. Biasanya
                    terjadi pada file biner atau diff yang terlalu besar.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="px-4 py-6 text-sm text-slate-500">
              Belum ada file yang bisa dibandingkan.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
