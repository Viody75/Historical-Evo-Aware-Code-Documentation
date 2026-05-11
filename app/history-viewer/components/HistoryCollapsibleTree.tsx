"use client";

import {
  applyCollapsedState,
  collectNodeMap,
  createHistoryTree,
  createInitialCollapsed,
  treeLabel,
  truncateLabel,
} from "@/app/history-viewer/lib/historyTree";
import {
  hierarchy,
  linkHorizontal,
  select,
  tree,
  zoom,
  zoomIdentity,
} from "d3";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  HistoryTreeNode,
  HistoricalExportPayload,
  SnapshotNavigationTarget,
  SnapshotSummaryIndex,
} from "@/app/history-viewer/types";

type ViewTransform = {
  x: number;
  y: number;
  k: number;
};

type RenderNode = HistoryTreeNode & {
  x: number;
  y: number;
  depth: number;
  hasChildren: boolean;
};

type RenderLink = {
  source: { x: number; y: number };
  target: { x: number; y: number };
};

const rowSpacing = 44;
const depthSpacing = 250;
const canvasPadding = 48;
const minimapWidth = 240;
const minimapHeight = 150;

function nodeColor(kind: HistoryTreeNode["kind"]) {
  if (kind === "root") return "#0f172a";
  if (kind === "issues") return "#2563eb";
  if (kind === "issue") return "#0f766e";
  if (kind === "group") return "#7c3aed";
  if (kind === "commit") return "#b45309";
  if (kind === "rationale") return "#dc2626";
  if (kind === "discussion") return "#475569";
  return "#64748b";
}

function nodeRadius(kind: HistoryTreeNode["kind"], hasChildren: boolean) {
  if (kind === "root") return 8;
  if (hasChildren) return 7;
  return 5;
}

export function HistoryCollapsibleTree({
  payload,
  summaryIndex,
  persistedTree,
  onNavigateTarget,
}: {
  payload: HistoricalExportPayload;
  summaryIndex?: SnapshotSummaryIndex | null;
  persistedTree?: HistoryTreeNode | null;
  onNavigateTarget?: (target: SnapshotNavigationTarget) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const zoomBehaviorRef = useRef<ReturnType<
    typeof zoom<SVGSVGElement, unknown>
  > | null>(null);

  const treeRoot = useMemo(
    () => persistedTree || createHistoryTree(payload, summaryIndex || null),
    [payload, persistedTree, summaryIndex],
  );
  const nodeMap = useMemo(() => collectNodeMap(treeRoot), [treeRoot]);

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() =>
    createInitialCollapsed(treeRoot),
  );
  const [selectedNodeId, setSelectedNodeId] = useState("root");
  const [searchTerm, setSearchTerm] = useState("");
  const [viewportSize, setViewportSize] = useState({ width: 920, height: 680 });
  const [transform, setTransform] = useState<ViewTransform>({
    x: 32,
    y: 32,
    k: 1,
  });

  const visibleTree = useMemo(
    () => applyCollapsedState(treeRoot, collapsedIds),
    [treeRoot, collapsedIds],
  );

  const layout = useMemo(() => {
    const rootHierarchy = hierarchy(visibleTree);
    const layoutEngine = tree<HistoryTreeNode>().nodeSize([rowSpacing, depthSpacing]);
    const laidOutRoot = layoutEngine(rootHierarchy);
    const descendants = laidOutRoot.descendants();
    const minX = Math.min(...descendants.map((node) => node.x));
    const maxX = Math.max(...descendants.map((node) => node.x));
    const maxY = Math.max(...descendants.map((node) => node.y));

    const nodes: RenderNode[] = descendants.map((node) => ({
      ...node.data,
      x: node.y + canvasPadding,
      y: node.x - minX + canvasPadding,
      depth: node.depth,
      hasChildren: node.children ? node.children.length > 0 : false,
    }));

    const links: RenderLink[] = laidOutRoot.links().map((link) => ({
      source: {
        x: link.source.y + canvasPadding,
        y: link.source.x - minX + canvasPadding,
      },
      target: {
        x: link.target.y + canvasPadding,
        y: link.target.x - minX + canvasPadding,
      },
    }));

    return {
      nodes,
      links,
      width: Math.max(1200, maxY + canvasPadding * 2 + 380),
      height: Math.max(520, maxX - minX + canvasPadding * 2 + 80),
    };
  }, [visibleTree]);

  const nodeById = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout.nodes],
  );

  const selectedNode = nodeById.get(selectedNodeId) ?? layout.nodes[0];

  const searchMatches = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) {
      return [];
    }

    return Array.from(nodeMap.values())
      .filter((node) => treeLabel(node).includes(query))
      .slice(0, 24);
  }, [nodeMap, searchTerm]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      setViewportSize({
        width: Math.max(720, Math.floor(entry.contentRect.width)),
        height: Math.max(560, Math.floor(entry.contentRect.height)),
      });
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!svgRef.current) {
      return;
    }

    const svgSelection = select(svgRef.current);
    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.35, 2.4])
      .on("zoom", (event) => {
        setTransform({
          x: event.transform.x,
          y: event.transform.y,
          k: event.transform.k,
        });
      });

    zoomBehaviorRef.current = zoomBehavior;
    svgSelection.call(zoomBehavior);
    svgSelection.call(
      zoomBehavior.transform,
      zoomIdentity.translate(32, 32).scale(1),
    );

    return () => {
      svgSelection.on(".zoom", null);
    };
  }, []);

  const centerOnNode = (nodeId: string) => {
    const node = nodeById.get(nodeId);
    if (!node || !svgRef.current || !zoomBehaviorRef.current) {
      return;
    }

    const nextTransform = zoomIdentity
      .translate(
        viewportSize.width * 0.28 - node.x * transform.k,
        viewportSize.height / 2 - node.y * transform.k,
      )
      .scale(transform.k);

    select(svgRef.current)
      .transition()
      .duration(350)
      .call(zoomBehaviorRef.current.transform, nextTransform);
  };

  const handleNodeClick = (node: RenderNode) => {
    setSelectedNodeId(node.id);
    if (node.target) {
      onNavigateTarget?.(node.target);
    }

    if (!nodeMap.get(node.id)?.children.length) {
      centerOnNode(node.id);
      return;
    }

    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) {
        next.delete(node.id);
      } else {
        next.add(node.id);
      }
      return next;
    });

    window.setTimeout(() => centerOnNode(node.id), 60);
  };

  const handleSearchSelect = (nodeId: string) => {
    const targetNode = nodeMap.get(nodeId);
    const nextCollapsed = new Set(collapsedIds);
    let cursor = targetNode?.parentId ?? null;

    while (cursor) {
      nextCollapsed.delete(cursor);
      cursor = nodeMap.get(cursor)?.parentId ?? null;
    }

    setCollapsedIds(nextCollapsed);
    setSelectedNodeId(nodeId);
    if (targetNode?.target) {
      onNavigateTarget?.(targetNode.target);
    }
    window.setTimeout(() => centerOnNode(nodeId), 80);
  };

  const zoomBy = (factor: number) => {
    if (!svgRef.current || !zoomBehaviorRef.current) {
      return;
    }

    select(svgRef.current)
      .transition()
      .duration(220)
      .call(zoomBehaviorRef.current.scaleBy, factor);
  };

  const resetView = () => {
    setCollapsedIds(createInitialCollapsed(treeRoot));
    setSelectedNodeId("root");

    if (!svgRef.current || !zoomBehaviorRef.current) {
      return;
    }

    select(svgRef.current)
      .transition()
      .duration(260)
      .call(
        zoomBehaviorRef.current.transform,
        zoomIdentity.translate(32, 32).scale(1),
      );
  };

  const expandAll = () => {
    setCollapsedIds(new Set());
  };

  const collapseDeep = () => {
    const next = new Set<string>();

    for (const [id, node] of nodeMap.entries()) {
      if (id !== "root" && id !== "issues" && node.children.length > 0) {
        next.add(id);
      }
    }

    setCollapsedIds(next);
    setSelectedNodeId("root");
  };

  const linkPath = useMemo(
    () =>
      linkHorizontal<RenderLink, { x: number; y: number }>()
        .x((point) => point.x)
        .y((point) => point.y),
    [],
  );

  const minimapScale = Math.min(
    minimapWidth / layout.width,
    minimapHeight / layout.height,
  );
  const minimapViewport = {
    x: Math.max(0, -transform.x / transform.k) * minimapScale,
    y: Math.max(0, -transform.y / transform.k) * minimapScale,
    width: (viewportSize.width / transform.k) * minimapScale,
    height: (viewportSize.height / transform.k) * minimapScale,
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_340px]">
      <div className="rounded-2xl border border-slate-200 bg-slate-50">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-4 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-medium text-slate-900">
                Click a node to expand or collapse the tree
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => zoomBy(1.2)}
                className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100"
              >
                Zoom in
              </button>
              <button
                onClick={() => zoomBy(0.84)}
                className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100"
              >
                Zoom out
              </button>
              <button
                onClick={expandAll}
                className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100"
              >
                Expand all
              </button>
              <button
                onClick={collapseDeep}
                className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100"
              >
                Collapse deep
              </button>
              <button
                onClick={resetView}
                className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Reset view
              </button>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <label className="block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Search node
              </label>
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Issue number, commit sha, filename..."
                className="mt-2 w-full border-0 bg-transparent p-0 text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
              {searchTerm.trim()
                ? `${searchMatches.length} matches shown`
                : "Search will auto-expand the matching path"}
            </div>
          </div>

          {searchMatches.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {searchMatches.map((match) => (
                <button
                  key={match.id}
                  onClick={() => handleSearchSelect(match.id)}
                  className="rounded-full bg-white px-3 py-2 text-left text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
                >
                  {truncateLabel(match.label, 54)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div ref={containerRef} className="relative h-[760px] overflow-hidden">
          <svg
            ref={svgRef}
            width={viewportSize.width}
            height={viewportSize.height}
            viewBox={`0 0 ${viewportSize.width} ${viewportSize.height}`}
            className="block h-full w-full bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.06),_transparent_28%),linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)]"
            role="img"
            aria-label="D3 collapsible history tree"
          >
            <g
              transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}
            >
              {layout.links.map((link, index) => (
                <path
                  key={`${link.source.x}-${link.source.y}-${link.target.x}-${link.target.y}-${index}`}
                  d={linkPath(link) || ""}
                  fill="none"
                  stroke="#cbd5e1"
                  strokeWidth={2}
                  opacity={0.92}
                />
              ))}

              {layout.nodes.map((node) => {
                const isSelected = selectedNode?.id === node.id;
                const isCollapsed = collapsedIds.has(node.id);

                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x},${node.y})`}
                    className="cursor-pointer"
                    onClick={() => handleNodeClick(node)}
                  >
                    <circle
                      r={nodeRadius(
                        node.kind,
                        nodeMap.get(node.id)?.children.length ? true : false,
                      )}
                      fill={nodeColor(node.kind)}
                      stroke={isSelected ? "#0f172a" : "#ffffff"}
                      strokeWidth={isSelected ? 4 : 2.5}
                    />
                    {nodeMap.get(node.id)?.children.length ? (
                      <text x={-22} y={4} fontSize="11" fill="#64748b">
                        {isCollapsed ? "+" : "-"}
                      </text>
                    ) : null}
                    <text
                      x={16}
                      y={4}
                      fontSize="13"
                      fill="#0f172a"
                      fontWeight={
                        node.kind === "issue" || node.kind === "root"
                          ? 600
                          : 500
                      }
                    >
                      {truncateLabel(node.label)}
                    </text>
                    {node.meta ? (
                      <text x={16} y={21} fontSize="11" fill="#64748b">
                        {truncateLabel(node.meta, 34)}
                      </text>
                    ) : null}
                    <title>{`${node.label}${node.meta ? ` — ${node.meta}` : ""}`}</title>
                  </g>
                );
              })}
            </g>
          </svg>

          <div className="pointer-events-none absolute bottom-4 left-4 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Overview
            </p>
            <svg
              width={minimapWidth}
              height={minimapHeight}
              viewBox={`0 0 ${minimapWidth} ${minimapHeight}`}
            >
              <g transform={`scale(${minimapScale})`}>
                {layout.links.map((link, index) => (
                  <path
                    key={`mini-${index}`}
                    d={linkPath(link) || ""}
                    fill="none"
                    stroke="#cbd5e1"
                    strokeWidth={2}
                  />
                ))}
                {layout.nodes.map((node) => (
                  <circle
                    key={`mini-node-${node.id}`}
                    cx={node.x}
                    cy={node.y}
                    r={node.kind === "root" ? 5 : 3.5}
                    fill={nodeColor(node.kind)}
                  />
                ))}
              </g>
              <rect
                x={minimapViewport.x}
                y={minimapViewport.y}
                width={Math.min(minimapWidth, minimapViewport.width)}
                height={Math.min(minimapHeight, minimapViewport.height)}
                fill="rgba(37,99,235,0.08)"
                stroke="#2563eb"
                strokeWidth="1.5"
                rx="8"
              />
            </svg>
          </div>
        </div>
      </div>

      <aside className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Node Inspector
        </p>
        <h3 className="mt-2 text-lg font-semibold text-slate-950">
          {selectedNode?.label || "No node selected"}
        </h3>
        {selectedNode?.meta ? (
          <p className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
            {selectedNode.meta}
          </p>
        ) : null}

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
          {nodeMap.get(selectedNode?.id || "")?.children.length
            ? `${nodeMap.get(selectedNode?.id || "")?.children.length} child nodes`
            : "Leaf node"}
        </div>

        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Details
          </p>
          <div className="mt-2 max-h-[28rem] overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
            <pre className="whitespace-pre-wrap break-words text-xs leading-6 text-slate-700">
              {selectedNode?.detail ||
                "Select a node to inspect its details here."}
            </pre>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Legend
          </p>
          {[
            ["root", "Repository root"],
            ["issues", "Issue container"],
            ["issue", "Issue / PR story"],
            ["group", "Discussion / commit group"],
            ["commit", "Commit node"],
            ["rationale", "Rationale linked to commit"],
            ["discussion", "Discussion node"],
            ["change", "Code change leaf"],
          ].map(([kind, label]) => (
            <div
              key={kind}
              className="flex items-center gap-3 text-sm text-slate-600"
            >
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: nodeColor(kind as TreeNodeKind) }}
              />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
