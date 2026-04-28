#!/usr/bin/env python3
"""Train sklearn random forests from map-editor labels and predict all map cells."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

try:
    from sklearn.ensemble import RandomForestClassifier
except ModuleNotFoundError as error:  # pragma: no cover - exercised by local environment setup.
    raise SystemExit(
        "scikit-learn is required for map-editor training. "
        "Install it with: npm run map-editor:deps"
    ) from error

TYPE_LABELS = ["road", "sidewalk", "park", "water", "bridge", "building"]
BEHAVIOR_LABELS = ["walkable", "parkable", "drivable"]
GRID_SIZE = 256
PATCH_SIZE = 8
RNG_SEED = 20260427


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--map", type=Path, required=True)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--grid-size", type=int, default=GRID_SIZE)
    parser.add_argument("--trees", type=int, default=48)
    return parser.parse_args()


def load_baseline(map_path: Path, grid_size: int) -> tuple[list[list[str]], dict[str, list[list[bool]]]]:
    data = json.loads(map_path.read_text(encoding="utf-8"))
    legend = data["legend"]
    type_rows: list[list[str]] = []
    behavior_rows = {property_name: [] for property_name in BEHAVIOR_LABELS}

    for y in range(grid_size):
        row = data["rows"][y]
        type_row = []
        behavior_row_map = {property_name: [] for property_name in BEHAVIOR_LABELS}

        for x in range(grid_size):
            entry = legend[row[x]]
            label = "park" if entry["category"] == "sidewalk" and entry["subcategory"] == "park" else entry["category"]
            type_row.append(label)

            for property_name in BEHAVIOR_LABELS:
                behavior_row_map[property_name].append(bool(entry[property_name]))

        type_rows.append(type_row)

        for property_name in BEHAVIOR_LABELS:
            behavior_rows[property_name].append(behavior_row_map[property_name])

    return type_rows, behavior_rows


def build_features(
    source_path: Path,
    baseline_type_rows: list[list[str]],
    baseline_behavior_rows: dict[str, list[list[bool]]],
    grid_size: int,
) -> np.ndarray:
    image = Image.open(source_path).convert("RGB")
    resized = image.resize((grid_size * PATCH_SIZE, grid_size * PATCH_SIZE), Image.Resampling.BOX)
    pixels = np.asarray(resized, dtype=np.float32) / 255.0
    patches = pixels.reshape(grid_size, PATCH_SIZE, grid_size, PATCH_SIZE, 3).transpose(0, 2, 1, 3, 4)
    flat_pixels = patches.reshape(grid_size * grid_size, PATCH_SIZE * PATCH_SIZE * 3)

    means = patches.mean(axis=(2, 3))
    stds = patches.std(axis=(2, 3))
    mins = patches.min(axis=(2, 3))
    maxs = patches.max(axis=(2, 3))
    luma = patches.mean(axis=4)
    edge_horizontal = np.abs(luma[:, :, :, 1:] - luma[:, :, :, :-1]).mean(axis=(2, 3))
    edge_vertical = np.abs(luma[:, :, 1:, :] - luma[:, :, :-1, :]).mean(axis=(2, 3))

    r = patches[:, :, :, :, 0]
    g = patches[:, :, :, :, 1]
    b = patches[:, :, :, :, 2]
    mx = np.maximum.reduce([r, g, b])
    mn = np.minimum.reduce([r, g, b])
    saturation = np.divide(mx - mn, mx, out=np.zeros_like(mx), where=mx > 0)

    masks = np.stack(
        [
            ((r < 0.16) & (g > 0.25) & (b > 0.45) & (b > g + 0.10)).mean(axis=(2, 3)),
            ((g > 0.34) & (g > r + 0.04) & (g > b + 0.07) & (saturation > 0.14)).mean(axis=(2, 3)),
            ((mx > 0.14) & (mx < 0.42) & (saturation < 0.34)).mean(axis=(2, 3)),
            ((mx > 0.38) & (mx < 0.78) & (saturation < 0.22)).mean(axis=(2, 3)),
            ((mx < 0.24) & (saturation < 0.36)).mean(axis=(2, 3)),
            ((r > 0.42) & (g < 0.32) & (b < 0.34)).mean(axis=(2, 3)),
            ((b > 0.48) & (r < 0.40) & (g > 0.28)).mean(axis=(2, 3)),
        ],
        axis=2,
    )

    y_coords, x_coords = np.mgrid[0:grid_size, 0:grid_size]
    coords = np.stack([x_coords / (grid_size - 1), y_coords / (grid_size - 1)], axis=2).astype(np.float32)

    type_one_hot = np.zeros((grid_size, grid_size, len(TYPE_LABELS)), dtype=np.float32)
    type_index = {label: index for index, label in enumerate(TYPE_LABELS)}

    for y in range(grid_size):
        for x in range(grid_size):
            label = baseline_type_rows[y][x]
            if label in type_index:
                type_one_hot[y, x, type_index[label]] = 1.0

    behavior = np.stack(
        [np.asarray(baseline_behavior_rows[property_name], dtype=np.float32) for property_name in BEHAVIOR_LABELS],
        axis=2,
    )

    base = np.concatenate(
        [
            flat_pixels,
            means.reshape(-1, 3),
            stds.reshape(-1, 3),
            mins.reshape(-1, 3),
            maxs.reshape(-1, 3),
            edge_horizontal.reshape(-1, 1),
            edge_vertical.reshape(-1, 1),
            masks.reshape(-1, masks.shape[2]),
            coords.reshape(-1, 2),
            type_one_hot.reshape(-1, len(TYPE_LABELS)),
            behavior.reshape(-1, len(BEHAVIOR_LABELS)),
        ],
        axis=1,
    ).astype(np.float32)

    # Add low-dimensional neighborhood context. This lets the classifier learn that
    # ambiguous edge tiles often inherit meaning from nearby roads, water, or parks.
    low = np.concatenate([means, stds, masks, type_one_hot, behavior], axis=2)
    padded = np.pad(low, ((1, 1), (1, 1), (0, 0)), mode="edge")
    neighborhoods = []

    for dy in range(3):
        for dx in range(3):
            neighborhoods.append(padded[dy : dy + grid_size, dx : dx + grid_size])

    context = np.concatenate(neighborhoods, axis=2).reshape(grid_size * grid_size, -1).astype(np.float32)
    return np.concatenate([base, context], axis=1)


def train_layer(
    labels: list[dict[str, Any]],
    all_features: np.ndarray,
    baseline_flat: list[Any],
    tree_count: int,
) -> tuple[list[Any], dict[str, Any]]:
    if not labels:
        return baseline_flat, {
            "trained": False,
            "reason": "No manual labels for this layer.",
            "samples": 0,
        }

    indices = np.asarray([entry["y"] * GRID_SIZE + entry["x"] for entry in labels], dtype=np.int32)
    values = [entry.get("label", entry.get("value")) for entry in labels]
    unique = sorted(set(values), key=lambda value: str(value))

    if len(values) < 2 or len(unique) < 2:
        return baseline_flat, {
            "trained": False,
            "reason": "At least two classes/values are needed for random forest training.",
            "samples": len(values),
            "classes": stringify_counts(Counter(values)),
        }

    classifier = RandomForestClassifier(
        n_estimators=max(1, tree_count),
        random_state=RNG_SEED,
        n_jobs=-1,
        max_features="sqrt",
        class_weight="balanced_subsample",
        bootstrap=True,
        min_samples_leaf=1,
    )
    classifier.fit(all_features[indices], values)
    predictions = [to_json_value(value) for value in classifier.predict(all_features)]

    return predictions, {
        "trained": True,
        "model": "sklearn.RandomForestClassifier",
        "samples": len(values),
        "classes": stringify_counts(Counter(values)),
        "trees": int(classifier.n_estimators),
        "maxFeatures": classifier.max_features,
    }


def stringify_counts(counter: Counter) -> dict[str, int]:
    return {str(to_json_value(key)).lower() if isinstance(to_json_value(key), bool) else str(to_json_value(key)): int(value) for key, value in counter.items()}


def to_json_value(value: Any) -> Any:
    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        return float(value)
    return value


def reshape(values: list[Any], grid_size: int) -> list[list[Any]]:
    return [values[y * grid_size : (y + 1) * grid_size] for y in range(grid_size)]


def count_type_rows(rows: list[list[str]]) -> dict[str, int]:
    counter = Counter(value for row in rows for value in row)
    return {label: int(counter.get(label, 0)) for label in TYPE_LABELS}


def count_behavior_rows(rows: dict[str, list[list[bool]]]) -> dict[str, dict[str, int]]:
    result = {}

    for property_name, grid in rows.items():
        values = [bool(value) for row in grid for value in row]
        result[property_name] = {
            "true": int(sum(values)),
            "false": int(len(values) - sum(values)),
        }

    return result


def main() -> None:
    args = parse_args()
    labels = json.loads(args.labels.read_text(encoding="utf-8"))
    type_rows, behavior_rows = load_baseline(args.map, args.grid_size)
    features = build_features(args.source, type_rows, behavior_rows, args.grid_size)

    type_flat = [value for row in type_rows for value in row]
    predicted_type_flat, type_summary = train_layer(
        labels.get("typeLabels", labels.get("labels", [])),
        features,
        type_flat,
        args.trees,
    )
    predicted_type_rows = reshape(predicted_type_flat, args.grid_size)

    predicted_behavior_rows: dict[str, list[list[bool]]] = {}
    behavior_summaries = {}

    for property_name in BEHAVIOR_LABELS:
        baseline_flat = [bool(value) for row in behavior_rows[property_name] for value in row]
        predicted_flat, summary = train_layer(
            labels.get("behaviorLabels", {}).get(property_name, []),
            features,
            baseline_flat,
            args.trees,
        )
        predicted_behavior_rows[property_name] = reshape([bool(value) for value in predicted_flat], args.grid_size)
        behavior_summaries[property_name] = summary

    payload = {
        "ok": True,
        "gridSize": args.grid_size,
        "rows": predicted_type_rows,
        "behaviorRows": predicted_behavior_rows,
        "counts": count_type_rows(predicted_type_rows),
        "behaviorCounts": count_behavior_rows(predicted_behavior_rows),
        "summary": {
            "type": type_summary,
            "behavior": behavior_summaries,
            "featureCount": int(features.shape[1]),
            "seed": RNG_SEED,
            "sklearn": True,
        },
    }
    print(json.dumps(payload))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise
