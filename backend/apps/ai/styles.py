import math

from .design import COLOR_RE, invalid


def color(value):
    if not isinstance(value, str) or not COLOR_RE.fullmatch(value):
        invalid()


def number(value, low, high):
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or not low <= value <= high
    ):
        invalid()


def validate_effects(value):
    if value is None:
        return
    schemas = {
        "shadow": {"color": None, "blur": (0, 500), "offsetX": (-1000, 1000), "offsetY": (-1000, 1000)},
        "outline": {"color": None, "width": (0, 100)},
        "glow": {"color": None, "blur": (0, 500)},
        "background": {"color": None},
    }
    if not isinstance(value, dict) or set(value) - schemas.keys():
        invalid()
    for kind, effect in value.items():
        if not isinstance(effect, dict) or set(effect) != schemas[kind].keys():
            invalid()
        for key, bounds in schemas[kind].items():
            if bounds is None:
                color(effect[key])
            else:
                number(effect[key], *bounds)


def validate_background(value):
    if not isinstance(value, dict):
        invalid()
    if value.get("type") == "solid" and set(value) == {"type", "color"}:
        color(value["color"])
        return
    if value.get("type") != "gradient" or set(value) - {"type", "kind", "angle", "stops"}:
        invalid()
    if not isinstance(value.get("kind"), str) or value["kind"] not in {"linear", "radial"}:
        invalid()
    number(value.get("angle", 0), -360, 360)
    stops = value.get("stops")
    if not isinstance(stops, list) or not 2 <= len(stops) <= 16:
        invalid()
    previous = -1
    for stop in stops:
        if not isinstance(stop, dict) or set(stop) != {"offset", "color"}:
            invalid()
        number(stop["offset"], 0, 1)
        if stop["offset"] < previous:
            invalid()
        previous = stop["offset"]
        color(stop["color"])
