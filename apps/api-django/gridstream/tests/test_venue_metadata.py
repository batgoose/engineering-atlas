import pytest

from gridstream.venue_metadata import infer_is_indoor, infer_roof_type, map_roof_type


def test_map_roof_type_normalization():
    assert map_roof_type("closed") == "dome"
    assert map_roof_type("retractable roof") == "retractable"
    assert map_roof_type("outdoors") == "outdoors"
    assert map_roof_type("unknown") == "outdoors"


def test_infer_roof_type_name_overrides_and_indoor_flag():
    assert infer_roof_type(venue_name="Ford Field", raw_roof="outdoors") == "dome"
    assert infer_is_indoor(
        infer_roof_type(venue_name="Ford Field", raw_roof="outdoors")
    )

    assert (
        infer_roof_type(venue_name="AT&T Stadium", raw_roof="outdoors") == "retractable"
    )
    assert not infer_is_indoor(
        infer_roof_type(venue_name="AT&T Stadium", raw_roof="outdoors")
    )

    # Giants Stadium is always outdoors; ignore stale indoor hints.
    roof = infer_roof_type(
        venue_name="Giants Stadium",
        current_roof="outdoors",
        espn_indoor=True,
    )
    assert roof == "outdoors"
    assert not infer_is_indoor(roof)
