import type { ReactNode } from "react";

import type { DiffRow, FileTreeNode, PullRequestFile } from "@/app/history-viewer/types";

export class DiffParser {
  static parsePatchRows(patch: string): DiffRow[] {
    const rows: DiffRow[] = [];
    const lines = patch.split("\n");
    let beforeLine = 0;
    let afterLine = 0;

    for (const line of lines) {
      if (line.startsWith("@@")) {
        const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (match) {
          beforeLine = Number(match[1]);
          afterLine = Number(match[2]);
        }
        rows.push({
          kind: "context",
          beforeLineNumber: null,
          afterLineNumber: null,
          beforeText: line,
          afterText: line,
        });
        continue;
      }

      if (line.startsWith("-") && !line.startsWith("---")) {
        rows.push({
          kind: "delete",
          beforeLineNumber: beforeLine,
          afterLineNumber: null,
          beforeText: line.slice(1),
          afterText: "",
        });
        beforeLine += 1;
        continue;
      }

      if (line.startsWith("+") && !line.startsWith("+++")) {
        rows.push({
          kind: "add",
          beforeLineNumber: null,
          afterLineNumber: afterLine,
          beforeText: "",
          afterText: line.slice(1),
        });
        afterLine += 1;
        continue;
      }

      const text =
        line.startsWith(" ") || line.startsWith("\\") ? line.slice(1) : line;
      rows.push({
        kind: "context",
        beforeLineNumber: beforeLine,
        afterLineNumber: afterLine,
        beforeText: text,
        afterText: text,
      });
      beforeLine += 1;
      afterLine += 1;
    }

    return rows;
  }

  static getPaneClass(
    rowKind: DiffRow["kind"],
    side: "before" | "after",
    hasContent: boolean,
  ): string {
    if (rowKind === "delete" && side === "before") {
      return "bg-rose-50 text-rose-800";
    }

    if (rowKind === "add" && side === "after") {
      return "bg-emerald-50 text-emerald-800";
    }

    if (!hasContent) {
      return "bg-slate-50 text-slate-300";
    }

    return "bg-white text-slate-700";
  }

  static getLineClass(line: string): string {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      return "text-green-700 bg-green-50";
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      return "text-red-700 bg-red-50";
    }
    if (line.startsWith("@")) {
      return "text-slate-500 bg-slate-100";
    }
    return "text-slate-700";
  }
}

export class FileTreeBuilder {
  static build(files: PullRequestFile[]): FileTreeNode[] {
    const root: FileTreeNode[] = [];

    for (const file of files) {
      const parts = file.filename.split("/");
      let currentLevel = root;
      let currentPath = "";

      for (const [index, part] of parts.entries()) {
        const isFile = index === parts.length - 1;
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        let node = currentLevel.find(
          (item) => item.name === part && item.type === (isFile ? "file" : "folder"),
        );

        if (!node) {
          node = {
            name: part,
            path: currentPath,
            type: isFile ? "file" : "folder",
            file: isFile ? file : undefined,
            children: [],
          };
          currentLevel.push(node);
        }

        currentLevel = node.children;
      }
    }

    return root;
  }

  static render(
    nodes: FileTreeNode[],
    selectedFilename: string | undefined,
    onSelectFile: (filename: string) => void,
    renderFolderIcon: () => ReactNode,
    renderFileIcon: () => ReactNode,
    depth = 0,
  ): ReactNode {
    return nodes.map((node) => {
      if (node.type === "folder") {
        return (
          <div key={node.path}>
            <div
              className="flex items-center gap-2 px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500"
              style={{ paddingLeft: `${16 + depth * 14}px` }}
            >
              {renderFolderIcon()}
              <span className="truncate">{node.name}</span>
            </div>
            <div>
              {this.render(
                node.children,
                selectedFilename,
                onSelectFile,
                renderFolderIcon,
                renderFileIcon,
                depth + 1,
              )}
            </div>
          </div>
        );
      }

      const isSelected = selectedFilename === node.file?.filename;

      return (
        <button
          key={node.path}
          onClick={() => node.file && onSelectFile(node.file.filename)}
          className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm ${
            isSelected
              ? "bg-white text-slate-950"
              : "text-slate-600 hover:bg-white/70"
          }`}
          style={{ paddingLeft: `${16 + depth * 14}px` }}
        >
          <span className="flex min-w-0 items-center gap-2">
            {renderFileIcon()}
            <span className="truncate">{node.name}</span>
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium uppercase text-slate-600">
            {node.file?.status}
          </span>
        </button>
      );
    });
  }
}
