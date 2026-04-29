#!/usr/bin/env python3
"""Train sklearn random forests from the map editor's current in-memory state."""

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
EMPTY_LABEL_VALUES = (None, "")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--map", type=Path, default=None)
    parser.add_argument("--state", default=None, help="JSON file with rows/behaviorRows, or '-' to read stdin.")
    parser.add_argument("--grid-size", type=int, default=GRID_SIZE)
    parser.add_argument("--trees", type=int, default=48)
    return parser.parse_args()


def load_baseline(map_path: Path, grid_size: int) -> tuple[list[list[str]], dict[str, list[list[bool]]]]:
    data = read_json_object(map_path, "baseline map")
    validate_baseline_map(data, grid_size)
    legend = data["legend"]
    type_rows: list[list[str]] = []
    behavior_rows = {property_name: [] for property_name in BEHAVIOR_LABELS}

    for y in range(grid_size):
        row = data["rows"][y]
        type_row = []
        behavior_row_map = {property_name: [] for property_name in BEHAVIOR_LABELS}

        for x in range(grid_size):
            entry = legend[row[x]]
            type_row.append(entry["category"])

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
    try:
        with Image.open(source_path) as image:
            resized = image.convert("RGB").resize((grid_size * PATCH_SIZE, grid_size * PATCH_SIZE), Image.Resampling.BOX)
    except OSError as error:
        raise ValueError(f"Could not read source image {source_path}: {error}") from error
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
        [
            np.asarray(
                [[1.0 if value is True else 0.0 for value in row] for row in baseline_behavior_rows[property_name]],
                dtype=np.float32,
            )
            for property_name in BEHAVIOR_LABELS
        ],
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
    labeled_indices: list[int],
    labeled_values: list[Any],
    all_features: np.ndarray,
    current_flat: list[Any],
    tree_count: int,
) -> tuple[list[Any], dict[str, Any]]:
    if not labeled_values:
        return current_flat, {
            "trained": False,
            "skipped": True,
            "reason": "No non-empty labels for this layer.",
            "samples": 0,
        }

    indices = np.asarray(labeled_indices, dtype=np.int32)
    unique = sorted(set(labeled_values), key=lambda value: str(value))

    if len(labeled_values) < 2 or len(unique) < 2:
        return current_flat, {
            "trained": False,
            "skipped": True,
            "reason": "At least two classes/values are needed for random forest training.",
            "samples": len(labeled_values),
            "classes": stringify_counts(Counter(labeled_values)),
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
    classifier.fit(all_features[indices], labeled_values)
    predictions = [to_json_value(value) for value in classifier.predict(all_features)]

    return predictions, {
        "trained": True,
        "model": "sklearn.RandomForestClassifier",
        "samples": len(labeled_values),
        "classes": stringify_counts(Counter(labeled_values)),
        "trees": int(classifier.n_estimators),
        "maxFeatures": classifier.max_features,
    }


def stringify_counts(counter: Counter) -> dict[str, int]:
    return {str(to_json_value(key)).lower() if isinstance(to_json_value(key), bool) else str(to_json_value(key)): int(value) for key, value in counter.items()}


def to_json_value(value: Any) -> Any:
    if isinstance(value, np.str_):
        return str(value)
    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        return float(value)
    return value


def reshape(values: list[Any], grid_size: int) -> list[list[Any]]:
    return [values[y * grid_size : (y + 1) * grid_size] for y in range(grid_size)]


def flatten_labeled_values(rows: list[list[Any]]) -> tuple[list[int], list[Any], list[Any]]:
    current_flat = [value for row in rows for value in row]
    labeled_indices = [index for index, value in enumerate(current_flat) if not is_empty_label(value)]
    labeled_values = [current_flat[index] for index in labeled_indices]
    return labeled_indices, labeled_values, current_flat


def is_empty_label(value: Any) -> bool:
    return value in EMPTY_LABEL_VALUES


def count_type_rows(rows: list[list[Any]]) -> dict[str, int]:
    counter = Counter(value for row in rows for value in row)
    result = {label: int(counter.get(label, 0)) for label in TYPE_LABELS}
    result["empty"] = int(sum(count for value, count in counter.items() if is_empty_label(value)))
    return result


def count_behavior_rows(rows: dict[str, list[list[Any]]]) -> dict[str, dict[str, int]]:
    result = {}

    for property_name, grid in rows.items():
        values = [value for row in grid for value in row]
        result[property_name] = {
            "true": int(sum(1 for value in values if value is True)),
            "false": int(sum(1 for value in values if value is False)),
            "empty": int(sum(1 for value in values if is_empty_label(value))),
        }

    return result


def read_json_object(path: Path, description: str) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ValueError(f"Missing {description}: {path}") from error
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid JSON in {description} {path}: {error}") from error

    if not isinstance(data, dict):
        raise ValueError(f"{description.capitalize()} must be a JSON object: {path}")

    return data


def validate_grid_size(grid_size: int) -> None:
    if grid_size < 2:
        raise ValueError("--grid-size must be at least 2.")


def validate_baseline_map(data: dict[str, Any], grid_size: int) -> None:
    if data.get("width") != grid_size or data.get("height") != grid_size:
        raise ValueError(f"Baseline map must be {grid_size}x{grid_size}.")

    legend = data.get("legend")
    if not isinstance(legend, dict):
        raise ValueError("Baseline map legend must be an object.")

    rows = data.get("rows")
    if not isinstance(rows, list) or len(rows) != grid_size:
        raise ValueError(f"Baseline map rows must contain {grid_size} rows.")

    for y, row in enumerate(rows):
        if not isinstance(row, str) or len(row) != grid_size:
            raise ValueError(f"Baseline map row {y} must contain {grid_size} symbols.")

        for x, symbol in enumerate(row):
            entry = legend.get(symbol)
            if not isinstance(entry, dict):
                raise ValueError(f"Baseline map row {y} references missing legend symbol {symbol!r} at {x},{y}.")

            if entry.get("category") not in TYPE_LABELS:
                raise ValueError(f"Baseline map legend symbol {symbol!r} has unsupported category: {entry.get('category')!r}.")

            for property_name in BEHAVIOR_LABELS:
                if not isinstance(entry.get(property_name), bool):
                    raise ValueError(f"Baseline map legend symbol {symbol!r} must include boolean {property_name}.")


def read_state_object(state: str | None) -> dict[str, Any] | None:
    if state is None:
        return None

    if state == "-":
        try:
            data = json.load(sys.stdin)
        except json.JSONDecodeError as error:
            raise ValueError(f"Invalid JSON in current-state payload: {error}") from error

        if not isinstance(data, dict):
            raise ValueError("Current-state payload must be a JSON object.")

        return data

    return read_json_object(Path(state), "current-state payload")


def normalize_state_rows(data: dict[str, Any], grid_size: int) -> tuple[list[list[Any]], dict[str, list[list[Any]]]]:
    rows = data.get("rows")
    behavior_rows = data.get("behaviorRows")

    validate_state_type_rows(rows, grid_size)

    if not isinstance(behavior_rows, dict):
        raise ValueError("Current-state payload behaviorRows must be an object.")

    normalized_behavior = {}

    for property_name in BEHAVIOR_LABELS:
        property_rows = behavior_rows.get(property_name)
        validate_state_behavior_rows(property_name, property_rows, grid_size)
        normalized_behavior[property_name] = property_rows

    return rows, normalized_behavior


def validate_state_type_rows(rows: Any, grid_size: int) -> None:
    if not isinstance(rows, list) or len(rows) != grid_size:
        raise ValueError(f"Current-state rows must contain {grid_size} rows.")

    for y, row in enumerate(rows):
        if not isinstance(row, list) or len(row) != grid_size:
            raise ValueError(f"Current-state row {y} must contain {grid_size} labels.")

        for x, value in enumerate(row):
            if not is_empty_label(value) and value not in TYPE_LABELS:
                raise ValueError(f"Invalid current-state tile type at {x},{y}: {value!r}.")


def validate_state_behavior_rows(property_name: str, rows: Any, grid_size: int) -> None:
    if not isinstance(rows, list) or len(rows) != grid_size:
        raise ValueError(f"Current-state behaviorRows.{property_name} must contain {grid_size} rows.")

    for y, row in enumerate(rows):
        if not isinstance(row, list) or len(row) != grid_size:
            raise ValueError(f"Current-state behaviorRows.{property_name}[{y}] must contain {grid_size} booleans.")

        for x, value in enumerate(row):
            if not is_empty_label(value) and not isinstance(value, bool):
                raise ValueError(f"Current-state behaviorRows.{property_name} has non-boolean/non-empty value at {x},{y}.")


def main() -> None:
    args = parse_args()
    validate_grid_size(args.grid_size)
    state = read_state_object(args.state)

    if state is not None:
        type_rows, behavior_rows = normalize_state_rows(state, args.grid_size)
    elif args.map is not None:
        type_rows, behavior_rows = load_baseline(args.map, args.grid_size)
    else:
        raise ValueError("--state is required unless --map is provided.")

    features = build_features(args.source, type_rows, behavior_rows, args.grid_size)

    type_indices, type_values, type_flat = flatten_labeled_values(type_rows)
    predicted_type_flat, type_summary = train_layer(
        type_indices,
        type_values,
        features,
        type_flat,
        args.trees,
    )
    predicted_type_rows = reshape(predicted_type_flat, args.grid_size)

    predicted_behavior_rows: dict[str, list[list[Any]]] = {}
    behavior_summaries = {}

    for property_name in BEHAVIOR_LABELS:
        behavior_indices, behavior_values, behavior_flat = flatten_labeled_values(behavior_rows[property_name])
        predicted_flat, summary = train_layer(
            behavior_indices,
            behavior_values,
            features,
            behavior_flat,
            args.trees,
        )
        predicted_behavior_rows[property_name] = reshape([to_json_value(value) for value in predicted_flat], args.grid_size)
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
        print(f"Training failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
