#!/usr/bin/env python3
"""Build a 256x256 exact-tile Liberty City raw map from the source image.

The generated JSON and texture assets are raw importer output. The script
decomposes the source map into 65,536 source tiles, deduplicates exact duplicate
crops, and verifies that every texture layout entry points back to matching
source pixels.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
from collections import Counter, defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image

PROCESS_DIR = Path(__file__).resolve().parent
REPO_ROOT = PROCESS_DIR.parent

SOURCE = PROCESS_DIR / "source/gta1-liberty-city-hd.webp"
OUTPUT_MAP = PROCESS_DIR / "output/liberty-city-raw/tile-layout.json"
OUTPUT_TEXTURE_LAYOUT = PROCESS_DIR / "output/liberty-city-raw/texture-layout.json"
OUTPUT_TEXTURES = PROCESS_DIR / "output/liberty-city-raw"
PREVIEW = PROCESS_DIR / "output/gta-256-textured-preview.png"
GRID_SIZE = 256
WORLD_TILE_SIZE = 32
TEXTURE_SIZE = 32
TEXTURE_SET_NAME = "liberty-city"
RUNTIME_ATLAS_NAME = "liberty-city-atlas.webp"

SAFE_SYMBOLS = list("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+,-./:;<=>?@[]^_{|}~")
CATEGORY_PRIORITY = {"water": 0, "road": 1, "crosswalk": 2, "building": 3, "obstacle": 4, "sidewalk": 5, "park": 6}


@dataclass(frozen=True)
class TileDefinition:
    category: str
    variant: str
    walkable: bool
    drivable: bool
    parkable: bool


@dataclass(frozen=True)
class Cell:
    x: int
    y: int
    category: str
    variant: str
    walkable: bool
    drivable: bool
    parkable: bool


WALKABLE_ROAD_SUFFIX = "-walkable"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--output-map", type=Path, default=OUTPUT_MAP)
    parser.add_argument("--output-texture-layout", type=Path, default=OUTPUT_TEXTURE_LAYOUT)
    parser.add_argument("--output-textures", type=Path, default=OUTPUT_TEXTURES)
    parser.add_argument("--preview", type=Path, default=PREVIEW)
    parser.add_argument("--grid-size", type=int, default=GRID_SIZE)
    parser.add_argument("--tile-size", type=int, default=WORLD_TILE_SIZE)
    parser.add_argument("--texture-size", type=int, default=TEXTURE_SIZE)
    return parser.parse_args()


def load_rgb(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"))


def coverage(mask: np.ndarray, size: int) -> np.ndarray:
    image = Image.fromarray(mask.astype(np.uint8) * 255)
    return np.asarray(image.resize((size, size), Image.Resampling.BOX), dtype=np.float32) / 255.0


def shift(mask: np.ndarray, dx: int, dy: int) -> np.ndarray:
    height, width = mask.shape
    out = np.zeros_like(mask)
    src_y0 = max(0, -dy)
    src_y1 = height - max(0, dy)
    src_x0 = max(0, -dx)
    src_x1 = width - max(0, dx)
    dst_y0 = max(0, dy)
    dst_y1 = height - max(0, -dy)
    dst_x0 = max(0, dx)
    dst_x1 = width - max(0, -dx)
    out[dst_y0:dst_y1, dst_x0:dst_x1] = mask[src_y0:src_y1, src_x0:src_x1]
    return out


def neighbor_count(mask: np.ndarray, radius: int = 1) -> np.ndarray:
    height, width = mask.shape
    padded = np.pad(mask.astype(np.uint8), radius)
    out = np.zeros(mask.shape, dtype=np.uint16)
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            if dx == 0 and dy == 0:
                continue
            out += padded[radius + dy : radius + dy + height, radius + dx : radius + dx + width]
    return out


def dilate(mask: np.ndarray, radius: int = 1) -> np.ndarray:
    return neighbor_count(mask, radius) > 0


def source_features(rgb: np.ndarray, grid_size: int) -> dict[str, np.ndarray]:
    r = rgb[:, :, 0].astype(np.int16)
    g = rgb[:, :, 1].astype(np.int16)
    b = rgb[:, :, 2].astype(np.int16)
    mx = np.maximum.reduce([r, g, b])
    mn = np.minimum.reduce([r, g, b])
    value = mx / 255.0
    saturation = np.divide(mx - mn, mx, out=np.zeros_like(mx, dtype=np.float32), where=mx != 0)
    luma = (r + g + b) / 3.0

    water = (r < 38) & (g > 66) & (b > 118) & (b - g > 28) & (g - r > 42) & (saturation > 0.45)
    park = (g > 92) & (r >= 68) & (r <= 145) & (b < 95) & (g > b + 18) & (saturation > 0.20)
    asphalt = (
        (value >= 0.15)
        & (value <= 0.40)
        & (saturation < 0.42)
        & (r >= 36)
        & (r <= 105)
        & (g >= 36)
        & (g <= 108)
        & (b >= 30)
        & (b <= 90)
        & ~water
    )
    lane = (
        (r >= 76)
        & (g >= 82)
        & (b <= 86)
        & (np.abs(r - g) <= 45)
        & (g >= b + 20)
        & ~park
        & ~water
    )
    sidewalk = (value >= 0.32) & (value <= 0.66) & (saturation < 0.18) & ~water & ~park & ~asphalt
    roof = (value >= 0.30) & (value <= 0.70) & (saturation < 0.30) & ~water & ~park
    dark = (value < 0.30) & (saturation < 0.45) & ~water
    outline = (value < 0.24) & (saturation < 0.36) & ~water
    red_detail = (r > 112) & (g < 80) & (b < 82)
    blue_detail = (b > 128) & (r < 100) & (g > 76)

    edge = np.zeros(luma.shape, dtype=bool)
    edge[:, 1:] |= np.abs(luma[:, 1:] - luma[:, :-1]) > 18
    edge[1:, :] |= np.abs(luma[1:, :] - luma[:-1, :]) > 18

    masks = {
        "water": water,
        "park": park,
        "asphalt": asphalt,
        "lane": lane,
        "sidewalk": sidewalk,
        "roof": roof,
        "dark": dark,
        "outline": outline,
        "red_detail": red_detail,
        "blue_detail": blue_detail,
        "edge": edge,
    }
    return {name: coverage(mask, grid_size) for name, mask in masks.items()}


def initial_categories(features: dict[str, np.ndarray]) -> np.ndarray:
    size = features["water"].shape[0]
    category = np.full((size, size), "sidewalk", dtype=object)

    water = (features["water"] > 0.34) | ((features["water"] > 0.24) & (features["asphalt"] < 0.18))
    road = (
        ~water
        & (
            (features["asphalt"] > 0.34)
            | ((features["asphalt"] > 0.22) & (features["lane"] > 0.010))
            | ((features["asphalt"] > 0.28) & (features["dark"] > 0.28) & (features["edge"] < 0.42))
        )
    )
    park = ~water & ~road & (features["park"] > 0.22)
    building = (
        ~water
        & ~road
        & ~park
        & (
            ((features["roof"] > 0.52) & (features["edge"] > 0.10))
            | ((features["roof"] > 0.42) & (features["outline"] > 0.04))
            | ((features["roof"] > 0.36) & ((features["red_detail"] > 0.01) | (features["blue_detail"] > 0.01)))
        )
    )

    category[water] = "water"
    category[road] = "road"
    category[park] = "park"
    category[building] = "building"

    return category


def keep_road_components(category: np.ndarray, features: dict[str, np.ndarray]) -> None:
    size = category.shape[0]
    road = category == "road"
    seen = np.zeros((size, size), dtype=bool)
    keep = np.zeros((size, size), dtype=bool)

    for sy in range(size):
        for sx in range(size):
            if seen[sy, sx] or not road[sy, sx]:
                continue
            q = deque([(sx, sy)])
            seen[sy, sx] = True
            cells: list[tuple[int, int]] = []
            asphalt_sum = 0.0
            lane_sum = 0.0
            min_x = max_x = sx
            min_y = max_y = sy
            while q:
                x, y = q.popleft()
                cells.append((x, y))
                asphalt_sum += features["asphalt"][y, x]
                lane_sum += features["lane"][y, x]
                min_x = min(min_x, x)
                max_x = max(max_x, x)
                min_y = min(min_y, y)
                max_y = max(max_y, y)
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < size and 0 <= ny < size and not seen[ny, nx] and road[ny, nx]:
                        seen[ny, nx] = True
                        q.append((nx, ny))
            area = len(cells)
            span = max(max_x - min_x + 1, max_y - min_y + 1)
            avg_asphalt = asphalt_sum / area
            if area >= 5 and (span >= 4 or lane_sum > 0.08 or avg_asphalt > 0.60):
                for x, y in cells:
                    keep[y, x] = True

    rejected = (category == "road") & ~keep
    category[rejected & (features["roof"] > 0.34)] = "building"
    category[rejected & ~(features["roof"] > 0.34)] = "sidewalk"


def fill_building_enclosures(category: np.ndarray) -> int:
    """Fill non-building pockets that are fully enclosed by building tiles."""

    height, width = category.shape
    building = category == "building"
    outside = np.zeros(category.shape, dtype=bool)
    q: deque[tuple[int, int]] = deque()

    def enqueue(x: int, y: int) -> None:
        if not building[y, x] and not outside[y, x]:
            outside[y, x] = True
            q.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)

    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)

    while q:
        x, y = q.popleft()

        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < width and 0 <= ny < height:
                enqueue(nx, ny)

    enclosed = ~building & ~outside
    category[enclosed] = "building"

    return int(np.count_nonzero(enclosed))


def block_rooflike_walkable_islands(category: np.ndarray, features: dict[str, np.ndarray]) -> int:
    """Block isolated gray roof surfaces that otherwise resemble concrete walkways."""

    road_near = dilate(category == "road", 1)
    rooflike_island = (
        (category == "sidewalk")
        & ~road_near
        & (features["roof"] > 0.85)
        & (features["asphalt"] < 0.30)
        & (features["park"] < 0.20)
    )

    category[rooflike_island] = "building"

    return int(np.count_nonzero(rooflike_island))


def refine_categories(category: np.ndarray, features: dict[str, np.ndarray]) -> None:
    keep_road_components(category, features)
    water_near = dilate(category == "water", 1)
    category[(category == "building") & water_near] = "sidewalk"

    for _ in range(4):
        road_near = dilate(category == "road", 1)
        building_near = neighbor_count(category == "building")
        grow = (
            (category == "sidewalk")
            & (building_near >= 2)
            & ~water_near
            & ~road_near
            & (features["roof"] > 0.42)
            & (features["edge"] > 0.06)
            & (features["asphalt"] < 0.34)
        )
        category[grow] = "building"

    # Keep shoreline edges walkable, but do not carve roof edges back into sidewalk.
    category[(category == "building") & water_near] = "sidewalk"

    # Reconnect small one-cell road gaps caused by lane markings or seams.
    for _ in range(2):
        road = category == "road"
        horizontal_gap = (category == "sidewalk") & shift(road, 1, 0) & shift(road, -1, 0)
        vertical_gap = (category == "sidewalk") & shift(road, 0, 1) & shift(road, 0, -1)
        gap = (horizontal_gap | vertical_gap) & ((features["asphalt"] > 0.20) | (features["lane"] > 0.01))
        category[gap] = "road"

    fill_building_enclosures(category)
    block_rooflike_walkable_islands(category, features)


def water_crossing_roads(category: np.ndarray, features: dict[str, np.ndarray]) -> np.ndarray:
    water = category == "water"
    road = category == "road"
    water_near = dilate(water, 1)
    crossing = road & water_near & ((features["asphalt"] > 0.20) | (features["lane"] > 0.004))

    # Exclude narrow pedestrian/rail structures by requiring road continuity.
    road_or_crossing = road | crossing
    connected_horizontal = shift(road_or_crossing, 1, 0) | shift(road_or_crossing, -1, 0)
    connected_vertical = shift(road_or_crossing, 0, 1) | shift(road_or_crossing, 0, -1)
    return crossing & (connected_horizontal | connected_vertical)


def road_variant(mask: int) -> str:
    return {
        0: "isolated",
        1: "deadend-n",
        2: "deadend-e",
        3: "corner-ne",
        4: "deadend-s",
        5: "vertical",
        6: "corner-se",
        7: "t-east",
        8: "deadend-w",
        9: "corner-nw",
        10: "horizontal",
        11: "t-north",
        12: "corner-sw",
        13: "t-west",
        14: "t-south",
        15: "intersection",
    }[mask]


def edge_variant(category: np.ndarray, x: int, y: int, target: str) -> str:
    size = category.shape[0]
    mask = 0
    if y > 0 and category[y - 1, x] == target:
        mask |= 1
    if x + 1 < size and category[y, x + 1] == target:
        mask |= 2
    if y + 1 < size and category[y + 1, x] == target:
        mask |= 4
    if x > 0 and category[y, x - 1] == target:
        mask |= 8
    return f"mask-{mask:02d}"


def has_cardinal_neighbor(category: np.ndarray, x: int, y: int, target: str) -> bool:
    size = category.shape[0]
    return (
        (y > 0 and category[y - 1, x] == target)
        or (x + 1 < size and category[y, x + 1] == target)
        or (y + 1 < size and category[y + 1, x] == target)
        or (x > 0 and category[y, x - 1] == target)
    )


def tile_definition(category: str, variant: str) -> TileDefinition:
    """Return generated gameplay metadata for a semantic tile variant."""

    if category == "sidewalk":
        return TileDefinition(
            category=category,
            variant=variant,
            walkable=True,
            drivable=False,
            parkable="roadside" in variant,
        )

    if category == "park":
        return TileDefinition(
            category=category,
            variant=variant,
            walkable=True,
            drivable=False,
            parkable=False,
        )

    if category == "road":
        return TileDefinition(
            category=category,
            variant=variant,
            # Mixed road/curb tiles act as pedestrian crossing edges without opening full traffic lanes.
            walkable=variant.endswith(WALKABLE_ROAD_SUFFIX),
            drivable=True,
            parkable=False,
        )

    if category == "crosswalk":
        return TileDefinition(
            category=category,
            variant=variant,
            walkable=True,
            drivable=True,
            parkable=False,
        )

    return TileDefinition(
        category=category,
        variant=variant,
        walkable=False,
        drivable=False,
        parkable=False,
    )


def is_walkable_road(features: dict[str, np.ndarray], x: int, y: int) -> bool:
    return (
        features["sidewalk"][y, x] > 0.20
        and features["edge"][y, x] > 0.30
        and features["asphalt"][y, x] < 0.75
        and features["roof"][y, x] < 0.85
    )


def classify_variants(category: np.ndarray, features: dict[str, np.ndarray]) -> list[Cell]:
    size = category.shape[0]
    roadlike = category == "road"
    road_crossing = water_crossing_roads(category, features)
    water_near = dilate(category == "water", 1)

    cells: list[Cell] = []
    for y in range(size):
        for x in range(size):
            cat = str(category[y, x])
            if cat == "road":
                mask = 0
                if y > 0 and roadlike[y - 1, x]:
                    mask |= 1
                if x + 1 < size and roadlike[y, x + 1]:
                    mask |= 2
                if y + 1 < size and roadlike[y + 1, x]:
                    mask |= 4
                if x > 0 and roadlike[y, x - 1]:
                    mask |= 8
                sub = road_variant(mask)
                if is_walkable_road(features, x, y) or road_crossing[y, x]:
                    sub = f"{sub}{WALKABLE_ROAD_SUFFIX}"
            elif cat == "water":
                sub = edge_variant(category, x, y, "water")
            elif cat == "park":
                sub = "park"
            elif cat == "sidewalk":
                road_near = has_cardinal_neighbor(category, x, y, "road")

                if water_near[y, x] and road_near:
                    sub = "waterfront-roadside"
                elif water_near[y, x]:
                    sub = "waterfront"
                elif road_near:
                    sub = "roadside"
                else:
                    sub = "concrete"
            else:
                if features["dark"][y, x] > 0.32 or features["outline"][y, x] > 0.11:
                    sub = "dark"
                elif features["edge"][y, x] > 0.22:
                    sub = "detailed"
                elif features["roof"][y, x] > 0.68:
                    sub = "large-roof"
                else:
                    sub = "roof"
            definition = tile_definition(cat, sub)
            cells.append(
                Cell(
                    x=x,
                    y=y,
                    category=definition.category,
                    variant=definition.variant,
                    walkable=definition.walkable,
                    drivable=definition.drivable,
                    parkable=definition.parkable,
                )
            )
    return cells


def cell_bounds(x: int, y: int, image_width: int, image_height: int, grid_size: int) -> tuple[int, int, int, int]:
    x0 = int(round(x * image_width / grid_size))
    y0 = int(round(y * image_height / grid_size))
    x1 = int(round((x + 1) * image_width / grid_size))
    y1 = int(round((y + 1) * image_height / grid_size))
    return x0, y0, max(x0 + 1, x1), max(y0 + 1, y1)


def crop_tile(source: Image.Image, x: int, y: int, grid_size: int, texture_size: int) -> Image.Image:
    x0, y0, x1, y1 = cell_bounds(x, y, source.width, source.height, grid_size)
    return source.crop((x0, y0, x1, y1)).resize((texture_size, texture_size), Image.Resampling.LANCZOS)


def tile_feature(source: Image.Image, x: int, y: int, grid_size: int) -> np.ndarray:
    x0, y0, x1, y1 = cell_bounds(x, y, source.width, source.height, grid_size)
    crop = np.asarray(source.crop((x0, y0, x1, y1)).resize((4, 4), Image.Resampling.BOX), dtype=np.float32) / 255.0
    return crop.reshape(-1)


def kmeans(features: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
    if k <= 1 or len(features) <= 1:
        return np.zeros(len(features), dtype=np.int32), features[[0]]
    k = min(k, len(features))
    centers = [features[0]]
    distances = np.full(len(features), np.inf, dtype=np.float32)
    for _ in range(1, k):
        distances = np.minimum(distances, np.sum((features - centers[-1]) ** 2, axis=1))
        centers.append(features[int(np.argmax(distances))])
    centers = np.asarray(centers, dtype=np.float32)
    labels = np.zeros(len(features), dtype=np.int32)
    for _ in range(8):
        dists = np.sum((features[:, None, :] - centers[None, :, :]) ** 2, axis=2)
        labels = np.argmin(dists, axis=1)
        for index in range(k):
            members = features[labels == index]
            if len(members):
                centers[index] = np.mean(members, axis=0)
    return labels, centers


def variant_count(category: str, variant: str, count: int) -> int:
    if count < 24:
        return 1
    if category in {"road", "sidewalk", "building", "water"} and count >= 900:
        return 3
    if count >= 260:
        return 2
    return 1


def symbol_stream() -> Iterable[str]:
    yield from SAFE_SYMBOLS


def assign_symbols(cells: list[Cell], grid_size: int) -> tuple[dict[str, dict[str, object]], list[str]]:
    groups: dict[tuple[str, bool, bool, bool], str] = {}
    legend: dict[str, dict[str, object]] = {}
    symbols = symbol_stream()
    symbol_by_cell: dict[tuple[int, int], str] = {}

    for cell in sorted(cells, key=lambda item: (CATEGORY_PRIORITY[item.category], item.category, item.y, item.x)):
        key = (cell.category, cell.walkable, cell.drivable, cell.parkable)

        if key not in groups:
            symbol = next(symbols)
            groups[key] = symbol
            legend[symbol] = {
                "category": cell.category,
                "walkable": cell.walkable,
                "drivable": cell.drivable,
                "parkable": cell.parkable,
            }

        symbol_by_cell[(cell.x, cell.y)] = groups[key]

    rows = []
    for y in range(grid_size):
        rows.append("".join(symbol_by_cell[(x, y)] for x in range(grid_size)))

    return legend, rows


def source_tile_digest(source: Image.Image, bounds: tuple[int, int, int, int]) -> str:
    crop = source.crop(bounds).convert("RGBA")
    digest = hashlib.sha256()
    digest.update(str(crop.size).encode("ascii"))
    digest.update(crop.tobytes())
    return digest.hexdigest()


def decompose_source_tiles(
    source: Image.Image, grid_size: int
) -> tuple[list[list[int]], list[list[int]], dict[str, int]]:
    """Split the source image into grid cells and dedupe exact source crops."""

    digest_to_id: dict[str, int] = {}
    frames: list[list[int]] = []
    texture_rows: list[list[int]] = []

    for y in range(grid_size):
        row: list[int] = []
        for x in range(grid_size):
            bounds = cell_bounds(x, y, source.width, source.height, grid_size)
            digest = source_tile_digest(source, bounds)
            texture_id = digest_to_id.get(digest)

            if texture_id is None:
                texture_id = len(frames)
                digest_to_id[digest] = texture_id
                x0, y0, x1, y1 = bounds
                frames.append([x0, y0, x1 - x0, y1 - y0])

            row.append(texture_id)
        texture_rows.append(row)

    stats = {
        "cells": grid_size * grid_size,
        "uniqueTiles": len(frames),
        "duplicatesRemoved": grid_size * grid_size - len(frames),
    }
    return texture_rows, frames, stats


def verify_decomposition(source: Image.Image, grid_size: int, texture_rows: list[list[int]], frames: list[list[int]]) -> None:
    for y in range(grid_size):
        for x in range(grid_size):
            source_bounds = cell_bounds(x, y, source.width, source.height, grid_size)
            texture_id = texture_rows[y][x]
            frame = frames[texture_id]
            frame_bounds = (frame[0], frame[1], frame[0] + frame[2], frame[1] + frame[3])
            source_crop = source.crop(source_bounds).convert("RGBA")
            frame_crop = source.crop(frame_bounds).convert("RGBA")

            if source_crop.size != frame_crop.size or source_crop.tobytes() != frame_crop.tobytes():
                raise RuntimeError(f"Texture mismatch at tile {x},{y}: expected source bounds {source_bounds}, got frame {frame_bounds}")


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def write_compact_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8")


def write_map_json(path: Path, data: dict) -> None:
    """Write the large tile grid with compact per-row arrays for reviewable diffs."""

    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "{",
        f'  "width": {data["width"]},',
        f'  "height": {data["height"]},',
        f'  "tileSize": {data["tileSize"]},',
        f'  "textureSet": {json.dumps(data["textureSet"])},',
        '  "legend": ' + json.dumps(data["legend"], indent=2).replace("\n", "\n  ") + ",",
        '  "rows": [',
    ]

    for index, row in enumerate(data["rows"]):
        comma = "," if index + 1 < len(data["rows"]) else ""
        lines.append(f"    {json.dumps(row)}{comma}")

    lines.append("  ]")
    lines.append("}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_texture_layout_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "{",
        f'  "width": {data["width"]},',
        f'  "height": {data["height"]},',
        f'  "textureSet": {json.dumps(data["textureSet"])},',
        '  "textureRows": [',
    ]

    for index, row in enumerate(data["textureRows"]):
        comma = "," if index + 1 < len(data["textureRows"]) else ""
        lines.append(f"    {json.dumps(row, separators=(',', ':'))}{comma}")

    lines.append("  ]")
    lines.append("}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def prepare_texture_dir(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for pattern in ("*.png", "*.webp", "manifest.json"):
        for path in output_dir.glob(pattern):
            path.unlink()


def write_manifest(
    path: Path,
    atlas_file: str,
    source_width: int,
    source_height: int,
    frames: list[list[int]],
    stats: dict[str, int],
    texture_size: int,
) -> None:
    write_compact_json(
        path,
        {
            "name": TEXTURE_SET_NAME,
            "tileSize": texture_size,
            "atlas": {
                "file": atlas_file,
                "width": source_width,
                "height": source_height,
            },
            "frames": frames,
            "dedupe": stats,
        },
    )


def write_preview(path: Path, texture_layout: dict, source: Image.Image, frames: list[list[int]], texture_size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    preview = Image.new("RGB", (texture_layout["width"] * texture_size, texture_layout["height"] * texture_size))
    for y, row in enumerate(texture_layout["textureRows"]):
        for x, texture_id in enumerate(row):
            frame = frames[texture_id]
            crop = source.crop((frame[0], frame[1], frame[0] + frame[2], frame[1] + frame[3]))
            preview.paste(crop.resize((texture_size, texture_size), Image.Resampling.LANCZOS), (x * texture_size, y * texture_size))
    preview.resize((1024, 1024), Image.Resampling.BOX).save(path)


def main() -> None:
    args = parse_args()
    rgb = load_rgb(args.source)
    source_image = Image.fromarray(rgb, "RGB")
    features = source_features(rgb, args.grid_size)
    category = initial_categories(features)
    refine_categories(category, features)
    cells = classify_variants(category, features)

    legend, rows = assign_symbols(cells, args.grid_size)
    texture_rows, frames, stats = decompose_source_tiles(source_image, args.grid_size)
    verify_decomposition(source_image, args.grid_size, texture_rows, frames)

    prepare_texture_dir(args.output_textures)
    atlas_path = args.output_textures / RUNTIME_ATLAS_NAME
    shutil.copyfile(args.source, atlas_path)

    manifest = args.output_textures / "manifest.json"
    write_manifest(
        manifest,
        atlas_path.name,
        source_image.width,
        source_image.height,
        frames,
        stats,
        args.texture_size,
    )

    map_data = {
        "width": args.grid_size,
        "height": args.grid_size,
        "tileSize": args.tile_size,
        "textureSet": TEXTURE_SET_NAME,
        "legend": legend,
        "rows": rows,
    }
    texture_layout = {
        "width": args.grid_size,
        "height": args.grid_size,
        "textureSet": TEXTURE_SET_NAME,
        "textureRows": texture_rows,
    }
    write_map_json(args.output_map, map_data)
    write_texture_layout_json(args.output_texture_layout, texture_layout)
    write_preview(args.preview, texture_layout, source_image, frames, args.texture_size)

    cell_counts = Counter(f"{cell.category}/{cell.variant}" for cell in cells)
    print(f"wrote {args.output_map}")
    print(f"wrote {args.output_texture_layout}")
    print(f"wrote {manifest}")
    print(f"wrote {args.preview}")
    print(f"source atlas: {atlas_path}")
    print(f"source tiles checked: {stats['cells']}")
    print(f"unique tiles: {stats['uniqueTiles']}")
    print(f"duplicates removed: {stats['duplicatesRemoved']}")
    print("top cells:")
    for key, count in cell_counts.most_common(20):
        print(f"  {key}: {count}")


if __name__ == "__main__":
    main()
