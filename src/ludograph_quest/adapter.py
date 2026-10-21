"""Adapter for LudoGraph extraction envelopes into quest Rule IR fragments."""

from __future__ import annotations

from typing import Any, Mapping


def claims_to_evidence(
    claims: list[Mapping[str, Any]],
    *,
    source_id: str,
    evidence_prefix: str = "claim",
) -> list[dict[str, Any]]:
    """Convert claims to evidence records without inventing rule semantics."""

    evidence: list[dict[str, Any]] = []
    for index, claim in enumerate(claims):
        evidence.append(
            {
                "evidence_id": f"{evidence_prefix}-{index + 1:03d}",
                "source_id": source_id,
                "chunk_id": claim.get("chunk_id"),
                "summary": claim.get("summary", claim.get("predicate", "")),
                "certainty": claim.get("certainty", "explicit"),
                "evidence_assessment": claim.get("evidence_assessment", "unverified"),
            }
        )
    return evidence


def extraction_envelope_to_context(
    envelope: Mapping[str, Any],
) -> dict[str, Any]:
    """Return a lossless context for a future IR compiler.

    The adapter intentionally preserves claims and uncovered material instead of
    turning natural-language claims into executable transitions.
    """

    return {
        "ontology_version": envelope.get("ontology_version"),
        "scope": envelope.get("scope", {}),
        "status": envelope.get("status"),
        "nodes": list(envelope.get("nodes", [])),
        "claims": list(envelope.get("claims", [])),
        "uncovered": list(envelope.get("uncovered", [])),
        "diagnostics": envelope.get("diagnostics", {}),
    }
