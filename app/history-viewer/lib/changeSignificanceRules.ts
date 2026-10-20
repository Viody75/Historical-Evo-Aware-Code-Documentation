import type {
  SummaryChangeGroup,
  SummaryChangeKind,
  SummaryChangeSignificance,
} from "@/app/history-viewer/types";

export type ChangeSignificanceRule = {
  change: SummaryChangeKind;
  significance: SummaryChangeSignificance;
  group: SummaryChangeGroup;
  reason: string;
};

export const CHANGE_SIGNIFICANCE_RULES: ChangeSignificanceRule[] = [
  {
    change: "Loop condition",
    significance: "Medium",
    group: "body.conditions",
    reason:
      "The patch changes a loop condition, so the iteration count or termination condition may change.",
  },
  {
    change: "Control structure condition",
    significance: "Medium",
    group: "body.conditions",
    reason:
      "The patch changes a control-structure condition, so the program's decision path may change.",
  },
  {
    change: "Else-part insert",
    significance: "Medium",
    group: "body.conditions",
    reason:
      "The patch inserts an else branch, so fallback or alternative behavior may be introduced.",
  },
  {
    change: "Else-part delete",
    significance: "Medium",
    group: "body.conditions",
    reason:
      "The patch deletes an else branch, so fallback or alternative behavior may be removed.",
  },
  {
    change: "Statement insert/delete",
    significance: "Low",
    group: "body.statements",
    reason:
      "The patch inserts or deletes an ordinary statement, so its effect is local to the surrounding execution flow.",
  },
  {
    change: "Statement ordering change",
    significance: "Low",
    group: "body.statements",
    reason:
      "The patch reorders an existing statement without an obvious contract change, so its significance is usually local.",
  },
  {
    change: "Statement parent change",
    significance: "Medium",
    group: "body.statements",
    reason:
      "The patch moves a statement to a different parent or scope, so its execution context may change.",
  },
  {
    change: "Statement update",
    significance: "Low",
    group: "body.statements",
    reason:
      "The patch updates a statement without indicating a major contract change, so its effect is relatively low.",
  },
  {
    change: "Comment insert/delete",
    significance: "None",
    group: "body.comments",
    reason:
      "The patch only inserts or deletes comments, so it does not change runtime behavior.",
  },
  {
    change: "Comment update",
    significance: "None",
    group: "body.comments",
    reason:
      "The patch updates comment text, so it changes documentation but not runtime behavior.",
  },
  {
    change: "Class insert/delete",
    significance: "Crucial",
    group: "declaration.classes",
    reason:
      "The patch inserts or deletes a class, so the available abstraction or construction contract may change.",
  },
  {
    change: "Class update",
    significance: "Crucial",
    group: "declaration.classes",
    reason:
      "The patch updates a class declaration, so the abstraction contract or inheritance shape may change.",
  },
  {
    change: "Interface insert/delete",
    significance: "Crucial",
    group: "declaration.interfaces",
    reason:
      "The patch inserts or deletes an interface, type, or enum, so the data-shape contract may change.",
  },
  {
    change: "Interface update",
    significance: "Crucial",
    group: "declaration.interfaces",
    reason:
      "The patch updates an interface, type, or enum, so the data-shape contract may change.",
  },
  {
    change: "Parameter insert/delete",
    significance: "Crucial",
    group: "declaration.parameters",
    reason:
      "The patch inserts or deletes a parameter, so the function or API calling contract may change.",
  },
  {
    change: "Parameter ordering change",
    significance: "Crucial",
    group: "declaration.parameters",
    reason:
      "The patch reorders parameters, so positional callers may pass values to different arguments.",
  },
  {
    change: "Parameter type change",
    significance: "Crucial",
    group: "declaration.parameters",
    reason:
      "The patch changes a parameter type, so the input contract and caller compatibility may change.",
  },
  {
    change: "Parameter renaming",
    significance: "Medium",
    group: "declaration.parameters",
    reason:
      "The patch renames a parameter, so the readable function contract changes even if the value shape remains the same.",
  },
  {
    change: "Return type insert/delete",
    significance: "Crucial",
    group: "declaration.returnTypes",
    reason:
      "The patch inserts or deletes a return type, so the explicit output contract may change.",
  },
  {
    change: "Return type update",
    significance: "Crucial",
    group: "declaration.returnTypes",
    reason:
      "The patch updates a return type, so the function output contract and calling code may be affected.",
  },
];

export const CHANGE_SIGNIFICANCE_RULES_BY_CHANGE = new Map(
  CHANGE_SIGNIFICANCE_RULES.map((rule) => [rule.change, rule]),
);

export function getChangeSignificanceRule(change: SummaryChangeKind) {
  const rule = CHANGE_SIGNIFICANCE_RULES_BY_CHANGE.get(change);
  if (!rule) {
    throw new Error(`Missing significance rule for change type: ${change}`);
  }

  return rule;
}
