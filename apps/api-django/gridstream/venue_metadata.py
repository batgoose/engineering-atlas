"""
Venue roof / indoor normalization helpers.

The source feeds disagree on naming and roof flags. These helpers centralize
deterministic mapping so Venue.is_indoor is populated consistently.
"""

from __future__ import annotations

import re
from typing import Optional

ROOF_CHOICES = {"outdoors", "dome", "retractable"}

# Name-based overrides for venues whose roof type cannot be inferred reliably
# from a single feed flag.
VENUE_ROOF_OVERRIDES = {
    "at t stadium": "retractable",
    "allegiant stadium": "dome",
    "caesars superdome": "dome",
    "cowboys stadium": "retractable",
    "ford field": "dome",
    "georgia dome": "dome",
    "giants stadium": "outdoors",
    "lucas oil stadium": "retractable",
    "mall of america field": "dome",
    "mercedes-benz stadium": "retractable",
    "metrodome": "dome",
    "nrg stadium": "retractable",
    "rca dome": "dome",
    "reliant stadium": "retractable",
    "rogers centre": "retractable",
    "santiago bernabeu": "retractable",
    "silverdome": "dome",
    "state farm stadium": "retractable",
    "superdome": "dome",
    "the dome at america s center": "dome",
    "u.s. bank stadium": "dome",
    "university of phoenix stadium": "retractable",
}


def _normalize_name(value: str) -> str:
    text = (value or "").strip().lower()
    text = text.replace("'", " ")
    text = re.sub(r"[^a-z0-9.\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def map_roof_type(raw_roof: str) -> str:
    value = (raw_roof or "").strip().lower()
    mapping = {
        "outdoors": "outdoors",
        "outdoor": "outdoors",
        "outside": "outdoors",
        "open": "outdoors",
        "dome": "dome",
        "closed": "dome",
        "indoor": "dome",
        "retractable": "retractable",
        "retractable roof": "retractable",
    }
    return mapping.get(value, "outdoors")


def infer_roof_type(
    venue_name: str = "",
    raw_roof: str = "",
    current_roof: str = "",
    espn_indoor: Optional[bool] = None,
) -> str:
    normalized_name = _normalize_name(venue_name)
    override = VENUE_ROOF_OVERRIDES.get(normalized_name)
    if override in ROOF_CHOICES:
        return override

    observed_roof = map_roof_type(raw_roof)
    current_mapped = map_roof_type(current_roof)

    # Preserve stronger prior knowledge over generic "outdoors" observations.
    if current_mapped == "retractable" and observed_roof == "outdoors":
        return "retractable"
    if current_mapped == "dome" and observed_roof == "outdoors":
        return "dome"

    if observed_roof == "retractable":
        return "retractable"
    if observed_roof == "dome":
        return "dome"

    # Text fallback for old venue names that include "dome" explicitly.
    if "dome" in normalized_name:
        return "dome"

    # ESPN marks indoor for some venues; if roof feed is missing, treat as dome.
    if espn_indoor is True:
        return "dome"

    return current_mapped if current_mapped in ROOF_CHOICES else "outdoors"


def infer_is_indoor(roof_type: str) -> bool:
    roof = map_roof_type(roof_type)
    # Retractable is treated as "not reliably indoor" for game environment logic.
    return roof == "dome"
