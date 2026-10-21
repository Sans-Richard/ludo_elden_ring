"""Stable JSON-compatible verification report serialization."""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from .verifier import VerificationReport


def report_to_dict(report: VerificationReport) -> dict[str, Any]:
    return asdict(report)


def reports_to_dict(reports: tuple[VerificationReport, ...]) -> list[dict[str, Any]]:
    return [report_to_dict(report) for report in reports]
