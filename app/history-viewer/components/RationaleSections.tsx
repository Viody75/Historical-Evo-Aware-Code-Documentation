import { structureRationale } from "@/app/history-viewer/lib/historySummary";

export function RationaleSections({
  value,
  compact = false,
}: {
  value?: string;
  compact?: boolean;
}) {
  const rationale = structureRationale(value);
  const sections = [
    { label: "Cause", value: rationale.cause, tone: "border-rose-300" },
    { label: "Effect", value: rationale.effect, tone: "border-amber-300" },
    { label: "Solution", value: rationale.solution, tone: "border-emerald-300" },
  ];

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {sections.map((section) => (
        <div key={section.label} className={`border-l-2 pl-3 ${section.tone}`}>
          <div className="text-[11px] font-semibold uppercase text-slate-500">
            {section.label}
          </div>
          <div className="mt-0.5 text-sm leading-6 text-slate-700">
            {section.value}
          </div>
        </div>
      ))}
    </div>
  );
}
