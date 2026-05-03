#!/usr/bin/env python3
"""Train sklearn random forests from the map editor's current in-memory state."""

from __future__ import annotations

import argparse
import base64
import binascii
from io import BytesIO
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

TYPE_LABELS = ["road", "sidewalk", "park", "water", "building", "obstacle", "crosswalk"]
BEHAVIOR_LABELS = ["walkable", "parkable", "drivable"]
GRID_SIZE = 256
PATCH_SIZE = 8
RNG_SEED = 20260427
EMPTY_LABEL_VALUES = (None, "")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--state", required=True, help="JSON file with rows/behaviorRows, or '-' to read stdin.")
    parser.add_argument("--grid-size", type=int, default=GRID_SIZE)
    parser.add_argument("--trees", type=int, default=48)
    return parser.parse_args()


def build_features(
    source_path: Path,
    type_rows: list[list[Any]],
    behavior_rows: dict[str, list[list[Any]]],
    grid_size: int,
) -> tuple[np.ndarray, str]:
    return build_features_from_image(
        load_source_image(source_path, grid_size),
        type_rows,
        behavior_rows,
        grid_size,
        "source image",
    )


def build_features_from_texture_source(
    texture_feature_source: dict[str, Any],
    type_rows: list[list[Any]],
    behavior_rows: dict[str, list[list[Any]]],
    grid_size: int,
) -> tuple[np.ndarray, str]:
    return build_features_from_image(
        render_texture_feature_image(texture_feature_source, grid_size),
        type_rows,
        behavior_rows,
        grid_size,
        "textureRows",
    )


def build_features_from_image(
    resized: Image.Image,
    type_rows: list[list[Any]],
    behavior_rows: dict[str, list[list[Any]]],
    grid_size: int,
    feature_source: str,
) -> tuple[np.ndarray, str]:
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
            label = type_rows[y][x]
            if label in type_index:
                type_one_hot[y, x, type_index[label]] = 1.0

    behavior = np.stack(
        [
            np.asarray(
                [[1.0 if value is True else 0.0 for value in row] for row in behavior_rows[property_name]],
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
    return np.concatenate([base, context], axis=1), feature_source


def load_source_image(source_path: Path, grid_size: int) -> Image.Image:
    try:
        with Image.open(source_path) as image:
            return image.convert("RGB").resize((grid_size * PATCH_SIZE, grid_size * PATCH_SIZE), Image.Resampling.BOX)
    except OSError as error:
        raise ValueError(f"Could not read source image {source_path}: {error}") from error


def render_texture_feature_image(texture_feature_source: dict[str, Any], grid_size: int) -> Image.Image:
    if not isinstance(texture_feature_source, dict):
        raise ValueError("Current-state textureFeatureSource must be an object.")

    manifest = texture_feature_source.get("manifest")
    frames = validate_texture_feature_manifest(manifest)
    texture_rows = texture_feature_source.get("textureRows")
    validate_texture_rows_for_manifest(texture_rows, len(frames), grid_size)
    atlas_bytes = decode_image_data_url(texture_feature_source.get("atlasImage"), "texture atlas")

    try:
        with Image.open(BytesIO(atlas_bytes)) as atlas_image:
            atlas = atlas_image.convert("RGB")
    except OSError as error:
        raise ValueError(f"Could not read texture atlas image data: {error}") from error

    output = Image.new("RGB", (grid_size * PATCH_SIZE, grid_size * PATCH_SIZE), (16, 20, 16))
    patch_cache: dict[int, Image.Image] = {}

    for y in range(grid_size):
        for x in range(grid_size):
            texture_id = texture_rows[y][x]
            patch = patch_cache.get(texture_id)

            if patch is None:
                left, top, width, height = frames[texture_id]

                if left + width > atlas.width or top + height > atlas.height:
                    raise ValueError(f"Texture manifest frame {texture_id} exceeds atlas bounds.")

                patch = atlas.crop((left, top, left + width, top + height)).resize((PATCH_SIZE, PATCH_SIZE), Image.Resampling.BOX)
                patch_cache[texture_id] = patch

            output.paste(patch, (x * PATCH_SIZE, y * PATCH_SIZE))

    return output


def decode_image_data_url(value: Any, description: str) -> bytes:
    if not isinstance(value, str) or not value.startswith("data:image/"):
        raise ValueError(f"Current-state {description} must be an image data URL.")

    try:
        header, encoded = value.split(",", 1)
    except ValueError as error:
        raise ValueError(f"Current-state {description} data URL is missing a base64 payload.") from error

    if ";base64" not in header:
        raise ValueError(f"Current-state {description} data URL must be base64 encoded.")

    try:
        return base64.b64decode(encoded, validate=True)
    except binascii.Error as error:
        raise ValueError(f"Current-state {description} data URL has invalid base64 data.") from error


def validate_texture_feature_manifest(manifest: Any) -> list[list[int]]:
    if not isinstance(manifest, dict):
        raise ValueError("Current-state textureFeatureSource.manifest must be an object.")

    frames = manifest.get("frames")

    if not isinstance(frames, list) or not frames:
        raise ValueError("Current-state textureFeatureSource.manifest.frames must be a non-empty array.")

    normalized_frames = []

    for index, frame in enumerate(frames):
        if (
            not isinstance(frame, list)
            or len(frame) != 4
            or not all(type(value) is int for value in frame)
        ):
            raise ValueError(f"Texture manifest frame {index} must be [x, y, width, height].")

        if frame[0] < 0 or frame[1] < 0 or frame[2] <= 0 or frame[3] <= 0:
            raise ValueError(f"Texture manifest frame {index} has invalid bounds.")

        normalized_frames.append(frame)

    return normalized_frames


def validate_texture_rows_for_manifest(texture_rows: Any, frame_count: int, grid_size: int) -> None:
    if not isinstance(texture_rows, list) or len(texture_rows) != grid_size:
        raise ValueError(f"Current-state textureFeatureSource.textureRows must contain {grid_size} rows.")

    for y, row in enumerate(texture_rows):
        if not isinstance(row, list) or len(row) != grid_size:
            raise ValueError(f"Current-state textureFeatureSource.textureRows[{y}] must contain {grid_size} texture IDs.")

        for x, texture_id in enumerate(row):
            if type(texture_id) is not int or texture_id < 0 or texture_id >= frame_count:
                raise ValueError(f"Texture id {texture_id!r} at {x},{y} is outside the manifest frame list.")


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


def read_state_object(state: str) -> dict[str, Any]:
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
    type_rows, behavior_rows = normalize_state_rows(state, args.grid_size)
    texture_feature_source = state.get("textureFeatureSource")

    if texture_feature_source is not None:
        features, feature_source = build_features_from_texture_source(
            texture_feature_source,
            type_rows,
            behavior_rows,
            args.grid_size,
        )
    else:
        features, feature_source = build_features(args.source, type_rows, behavior_rows, args.grid_size)

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
            "featureSource": feature_source,
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
