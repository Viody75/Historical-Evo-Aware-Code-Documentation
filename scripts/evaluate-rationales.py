#!/usr/bin/env python3
"""Evaluate generated PR rationales against a reference using BERTScore.

See docs/rationale-evaluation.md for the evaluation protocol.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any


PLACEHOLDER_PREFIX = "REPLACE_WITH_"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Evaluate generated rationale against ground truth."
    )
    generated_input = parser.add_mutually_exclusive_group(required=True)
    generated_input.add_argument("--summary-index", type=Path)
    generated_input.add_argument("--generated-comparison", type=Path)
    parser.add_argument("--ground-truth", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--language", default=None)
    parser.add_argument("--model-type", default=None)
    parser.add_argument("--rescale-with-baseline", action="store_true")
    parser.add_argument("--allow-lexical-fallback", action="store_true")
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ValueError(f"File not found: {path}") from error
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid JSON in {path}: {error}") from error


def mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def collect_generated_claims(summary: dict[str, Any]) -> list[dict[str, str]]:
    explicit_claims = summary.get("generatedClaims")
    if "generatedClaims" in summary:
        if not isinstance(explicit_claims, list):
            raise ValueError("generatedClaims must be a JSON array")
        claims: list[dict[str, str]] = []
        claim_ids: set[str] = set()
        for claim in explicit_claims:
            if not isinstance(claim, dict):
                raise ValueError("Every generated claim must be a JSON object")
            claim_id = claim.get("id")
            text = claim.get("text")
            if not isinstance(claim_id, str) or not claim_id.strip():
                raise ValueError("Every generated claim needs a non-empty id")
            if claim_id in claim_ids:
                raise ValueError(f"Generated comparison repeats claim id {claim_id}")
            if not isinstance(text, str) or not text.strip():
                raise ValueError(f"Generated claim {claim_id} needs non-empty text")
            claim_ids.add(claim_id)
            claims.append({"id": claim_id, "text": text.strip()})
        return claims

    claims: list[dict[str, str]] = []

    for index, item in enumerate(summary.get("discussionNarratives") or []):
        text = " ".join(
            value.strip()
            for value in [item.get("narrative", ""), item.get("outcome", "")]
            if isinstance(value, str) and value.strip()
        )
        if text:
            claims.append({"id": f"discussionNarrative:{index}", "text": text})

    for index, item in enumerate(summary.get("whatChanged") or []):
        text = " ".join(
            value.strip()
            for value in [item.get("change", ""), item.get("rationale", "")]
            if isinstance(value, str) and value.strip()
        )
        if text:
            claims.append({"id": f"whatChanged:{index}", "text": text})

    return claims


def validate_ground_truth(issue: dict[str, Any]) -> None:
    issue_number = issue.get("issueNumber")
    reference = issue.get("referenceRationale")
    claims = issue.get("claims")
    if not isinstance(issue_number, int):
        raise ValueError("Every ground-truth issue needs an integer issueNumber")
    if not isinstance(reference, str) or not reference.strip():
        raise ValueError(f"PR #{issue_number} needs referenceRationale")
    if reference.startswith(PLACEHOLDER_PREFIX):
        raise ValueError(
            f"PR #{issue_number} still contains the reference rationale placeholder"
        )
    if not isinstance(claims, list) or not claims:
        raise ValueError(f"PR #{issue_number} needs at least one atomic claim")

    claim_ids: set[str] = set()
    for claim in claims:
        claim_id = claim.get("id")
        text = claim.get("text")
        evidence_refs = claim.get("evidenceRefs")
        if not isinstance(claim_id, str) or not claim_id.strip():
            raise ValueError(f"PR #{issue_number} has a claim without an id")
        if claim_id in claim_ids:
            raise ValueError(f"PR #{issue_number} repeats claim id {claim_id}")
        claim_ids.add(claim_id)
        if not isinstance(text, str) or not text.strip():
            raise ValueError(f"Ground-truth claim {claim_id} has no text")
        if text.startswith(PLACEHOLDER_PREFIX):
            raise ValueError(f"Ground-truth claim {claim_id} is still a placeholder")
        if not isinstance(evidence_refs, list) or not evidence_refs:
            raise ValueError(f"Ground-truth claim {claim_id} needs evidenceRefs")


def bert_scores(
    candidates: list[str],
    references: list[str],
    language: str,
    model_type: str | None,
    rescale_with_baseline: bool,
) -> tuple[list[float], list[float], list[float]]:
    try:
        from bert_score import score
    except ImportError as error:
        raise RuntimeError(
            "bert-score is not installed. Run: "
            "python3 -m pip install -r requirements-evaluation.txt"
        ) from error

    kwargs: dict[str, Any] = {
        "cands": candidates,
        "refs": references,
        "lang": language,
        "verbose": False,
        "rescale_with_baseline": rescale_with_baseline,
    }
    if model_type:
        kwargs["model_type"] = model_type

    precision, recall, f1 = score(**kwargs)
    return precision.tolist(), recall.tolist(), f1.tolist()


def token_overlap_scores(
    candidates: list[str], references: list[str]
) -> tuple[list[float], list[float], list[float]]:
    precision_values: list[float] = []
    recall_values: list[float] = []
    f1_values: list[float] = []

    for candidate, reference in zip(candidates, references, strict=True):
        candidate_tokens = Counter(re.findall(r"[\w'-]+", candidate.lower()))
        reference_tokens = Counter(re.findall(r"[\w'-]+", reference.lower()))
        overlap = sum(
            min(count, reference_tokens[token])
            for token, count in candidate_tokens.items()
        )
        candidate_count = sum(candidate_tokens.values())
        reference_count = sum(reference_tokens.values())
        precision = overlap / candidate_count if candidate_count else 0.0
        recall = overlap / reference_count if reference_count else 0.0
        f1 = (
            2 * precision * recall / (precision + recall)
            if precision + recall
            else 0.0
        )
        precision_values.append(precision)
        recall_values.append(recall)
        f1_values.append(f1)

    return precision_values, recall_values, f1_values


def resolve_metric_engine(allow_lexical_fallback: bool) -> str:
    try:
        import bert_score  # noqa: F401

        return "bert-score"
    except ImportError as error:
        if allow_lexical_fallback:
            return "token-overlap-fallback"
        raise RuntimeError(
            "bert-score is not installed. Run: "
            "python3 -m pip install -r requirements-evaluation.txt"
        ) from error


def calculate_similarity_scores(
    engine: str,
    candidates: list[str],
    references: list[str],
    language: str,
    model_type: str | None,
    rescale_with_baseline: bool,
) -> tuple[list[float], list[float], list[float]]:
    if engine == "bert-score":
        return bert_scores(
            candidates,
            references,
            language,
            model_type,
            rescale_with_baseline,
        )
    return token_overlap_scores(candidates, references)


def main() -> int:
    args = parse_args()

    generated_input_path = args.generated_comparison or args.summary_index
    if generated_input_path is None:
        raise ValueError("A generated comparison or summary index is required")
    generated_input = load_json(generated_input_path)
    ground_truth = load_json(args.ground_truth)
    language = args.language or ground_truth.get("language") or "en"
    metric_engine = resolve_metric_engine(args.allow_lexical_fallback)
    summaries = {
        item["issueNumber"]: item for item in generated_input.get("issues", [])
    }

    issue_results: list[dict[str, Any]] = []

    for ground_truth_issue in ground_truth.get("issues", []):
        validate_ground_truth(ground_truth_issue)
        issue_number = ground_truth_issue["issueNumber"]
        summary = summaries.get(issue_number)
        if not summary:
            raise ValueError(
                f"PR #{issue_number} is not present in the generated input"
            )

        generated_claims = collect_generated_claims(summary)
        if not generated_claims:
            raise ValueError(f"PR #{issue_number} has no generated rationale claims")
        reference_claims = ground_truth_issue["claims"]

        generated_text = "\n".join(claim["text"] for claim in generated_claims)
        full_precision, full_recall, full_f1 = calculate_similarity_scores(
            metric_engine,
            [generated_text],
            [ground_truth_issue["referenceRationale"]],
            language,
            args.model_type,
            args.rescale_with_baseline,
        )

        source_counts = Counter(
            item.get("evidenceSource", "unknown")
            for item in summary.get("whatChanged", [])
        )

        issue_results.append(
            {
                "issueNumber": issue_number,
                "similarityScore": {
                    "precision": full_precision[0],
                    "recall": full_recall[0],
                    "f1": full_f1[0],
                },
                "claimCounts": {
                    "generated": len(generated_claims),
                    "reference": len(reference_claims),
                },
                "discussionUtilization": {
                    "discussionNarrativeCount": len(
                        summary.get("discussionNarratives") or []
                    ),
                    "whatChangedEvidenceSources": dict(source_counts),
                    "discussionEvidenceRate": (
                        source_counts["discussion"] / sum(source_counts.values())
                        if sum(source_counts.values())
                        else None
                    ),
                },
            }
        )

    similarity_macro = {
        "precision": mean(
            [item["similarityScore"]["precision"] for item in issue_results]
        ),
        "recall": mean(
            [item["similarityScore"]["recall"] for item in issue_results]
        ),
        "f1": mean([item["similarityScore"]["f1"] for item in issue_results]),
    }
    aggregate = {
        "issueCount": len(issue_results),
        "similarityScoreMacro": similarity_macro,
    }
    if metric_engine == "bert-score":
        aggregate["bertScoreMacro"] = similarity_macro
        for item in issue_results:
            item["bertScore"] = item["similarityScore"]
    else:
        aggregate["tokenOverlapScoreMacro"] = similarity_macro
    result = {
        "dataset": ground_truth.get("dataset"),
        "generatedInput": str(generated_input_path),
        "groundTruth": str(args.ground_truth),
        "language": language,
        "modelType": args.model_type,
        "rescaleWithBaseline": args.rescale_with_baseline,
        "metricEngine": {
            "name": metric_engine,
            "semantic": metric_engine == "bert-score",
            "fallback": metric_engine != "bert-score",
        },
        "aggregate": aggregate,
        "issues": issue_results,
        "methodologicalNote": (
            "BERTScore measures semantic similarity to the reference text; it does "
            "not by itself prove factual correctness."
        ),
    }

    rendered = json.dumps(result, indent=2, ensure_ascii=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(f"{rendered}\n", encoding="utf-8")
        print(f"Evaluation written to {args.output}")
    else:
        print(rendered)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1) from error
