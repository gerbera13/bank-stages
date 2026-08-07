#!/usr/bin/env python3
"""
Извлечение геометрии плана из скриншота (стиль «Универсальный»).

Процесс (см. make-stage.md §«Новый план из скриншота»):
  1. Пользователь кладёт скриншот плана (напр. `Demo 1.jpg`).
  2. `python3 oas/extract-plan.py path/to/plan.png [--out plan.json]`
  3. Скрипт определяет область плана и выдаёт JSON-геометрию:
     rooms (помещения), corridor, walls, windows, doors.

Опознаваемые элементы (по цветам):
  - стены: серый ~#808080 или оранжевый акцент (~#F88040);
  - заливка помещений: жёлтая ~#FFFECE, служебные — светло-серые;
  - коридор: светлая горизонтальная лента между рядами помещений;
  - окна: голубые ~#C1FFFF;
  - двери: тёмная вертикальная полоска + светлая горизонтальная полоска
    (пересечение полосок — стиль организации, сохраняется при перерисовке).

Выход — координаты в системе исходного скриншота (пиксели). Масштаб 1 px = 20 мм.
"""

import argparse
import json

import cv2
import numpy as np
from PIL import Image


def masks(a):
    r, g, b = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int)
    return {
        "gray": (np.abs(r - 128) < 14) & (np.abs(g - 128) < 14) & (np.abs(b - 128) < 14),
        "orange": (r > 235) & (g > 110) & (g < 150) & (b < 95),
        "cyan": (r > 180) & (r < 215) & (g > 245) & (b > 245),
        "stripe": (r > 212) & (r < 236) & (np.abs(g - r) < 5) & (np.abs(b - r) < 6),
        "fill": (r > 245) & (g > 235) & (b > 185) & (b < 222),
        "dark": (r + g + b) / 3 < 170,
    }


def clusters(prof, gap, min_len=1):
    nz = np.argwhere(prof > 0).flatten()
    out = []
    if not len(nz):
        return out
    s, p = nz[0], nz[0]
    for v in nz[1:]:
        if v - p > gap:
            if p - s >= min_len:
                out.append((int(s), int(p)))
            s = v
        p = v
    if p - s >= min_len:
        out.append((int(s), int(p)))
    return out


def plan_bbox(a, m):
    """Область плана: жёлтая заливка помещений + стены вокруг неё.
    Заливка может распадаться на ряды (коридор между ними) — берём все крупные компоненты."""
    fill = m["fill"].astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(fill, 8)
    big = [stats[i] for i in range(1, n) if stats[i][4] > 3000]
    if not big:
        raise SystemExit("план не найден: нет жёлтой заливки помещений")
    fx0 = int(min(s[0] for s in big))
    fy0 = int(min(s[1] for s in big))
    fx1 = int(max(s[0] + s[2] for s in big))
    fy1 = int(max(s[1] + s[3] for s in big))
    wall = (m["gray"] | m["orange"])
    pad = 60
    y0, y1 = max(0, fy0 - pad), min(a.shape[0], fy1 + pad)
    x0, x1 = max(0, fx0 - pad), min(a.shape[1], fx1 + pad)
    ys, xs = np.argwhere(wall[y0:y1, x0:x1]).T
    if not len(xs):
        raise SystemExit("план не найден: нет стен")
    return int(x0 + xs.min()), int(y0 + ys.min()), int(x0 + xs.max()), int(y0 + ys.max())


def main(path, out):
    img = Image.open(path).convert("RGB")
    a = np.array(img).astype(np.uint8)
    m = masks(a)
    wall = m["gray"] | m["orange"]

    x0, y0, x1, y1 = plan_bbox(a, m)
    pad = 4
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(a.shape[1], x1 + pad), min(a.shape[0], y1 + pad)
    print(f"план: x {x0}..{x1}, y {y0}..{y1} ({x1-x0}x{y1-y0} px)")

    # --- горизонтальные стены (ряды, покрывающие всю ширину) ---
    prof = wall[y0 : y1 + 1, x0 : x1 + 1].sum(axis=1)
    hwalls = []
    for y in range(y1 - y0 + 1):
        if prof[y] > 0.5 * (x1 - x0):
            if hwalls and y - hwalls[-1][-1] <= 3:
                hwalls[-1].append(y)
            else:
                hwalls.append([y])
    hwalls = [(y0 + c[0], y0 + c[-1]) for c in hwalls]
    # склеиваем сегменты одной стены, разорванные окнами (зазор < 20 px)
    merged = [hwalls[0]]
    for s, e in hwalls[1:]:
        if s - merged[-1][1] <= 20:
            merged[-1] = (merged[-1][0], e)
        else:
            merged.append((s, e))
    hwalls = merged
    print("горизонтальные стены:", hwalls)

    # --- коридор: светлая полоса на всю ширину между рядами помещений ---
    corridor = None
    # зона между верхней и нижней стенами
    y_top = hwalls[0][1] if hwalls else y0
    y_bot = hwalls[-1][0] if hwalls else y1
    for y in range(y_top, y_bot):
        row_stripe = m["stripe"][y, x0 : x1 + 1].mean()
        row_fill = m["fill"][y, x0 : x1 + 1].mean()
        if row_stripe > 0.3 and row_fill < 0.15:
            if corridor and y - corridor["y"] - corridor["h"] <= 2:
                corridor["h"] = y - corridor["y"] + 1
            else:
                corridor = {"x": x0, "y": y, "w": x1 - x0, "h": 1}
    if corridor:
        # оставляем только широкую ленту (не единичные строки)
        if corridor["h"] < 15:
            corridor = None
    print("коридор:", corridor)

    # --- помещения: ряд сверху и ряд снизу от коридора, делятся вертикальными стенами ---
    bands = []
    if corridor:
        bands.append((hwalls[0][1] + 1, corridor["y"] - 1))  # ряд 1
        bands.append((corridor["y"] + corridor["h"] + 1, hwalls[-1][0] - 1))  # ряд 2
    rooms = []
    lum = (a[..., 0].astype(int) + a[..., 1].astype(int) + a[..., 2].astype(int)) / 3
    for (by0, by1) in bands:
        if by1 - by0 < 25:
            continue
        bh = by1 - by0 + 1
        # колонки текста подписей: тёмные пиксели почти по всей высоте
        dark_frac = (lum[by0 : by1 + 1, x0 : x1 + 1] < 130).mean(axis=0)
        text_col = dark_frac > 0.2
        # доля заливки в каждой колонке: стены/разделители = колонки без заливки
        ff = m["fill"][by0 : by1 + 1, x0 : x1 + 1].mean(axis=0)
        gaps = clusters(((ff < 0.2) & ~text_col).astype(int), 6, min_len=2)
        bounds, svc = [], []
        for s, p in gaps:
            w = p - s
            if s <= 2:
                bounds.append(p + x0)  # левая внешняя стена
            elif p >= (x1 - x0) - 2:
                bounds.append(s + x0)  # правая внешняя стена
            elif w > 20:
                svc.append({"x": int(s + x0), "y": int(by0), "w": int(w), "h": int(bh), "service": True})
                bounds += [s + x0, p + x0]
            else:
                bounds.append((s + p) // 2 + x0)  # вертикальная стена/разделитель
        bounds = sorted(set(bounds))
        for i in range(len(bounds) - 1):
            w = bounds[i + 1] - bounds[i]
            if w >= 25:
                fp = m["fill"][by0 : by1 + 1, bounds[i] : bounds[i + 1]].mean()
                svc.append(
                    {
                        "x": int(bounds[i]),
                        "y": int(by0),
                        "w": int(w),
                        "h": int(bh),
                        "service": bool(fp < 0.25),
                    }
                )
        seen = set()
        for r in sorted(svc, key=lambda r: (r["x"], r["w"])):
            key = (r["x"], r["y"], r["w"], r["h"])
            if key not in seen:
                seen.add(key)
                rooms.append(r)
    print(f"помещений: {len(rooms)}")

    # --- окна (голубые) ---
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m["cyan"].astype(np.uint8), 8)
    windows = [
        {"x": int(stats[i][0]), "y": int(stats[i][1]), "w": int(stats[i][2]), "h": int(stats[i][3])}
        for i in range(1, n)
        if stats[i][4] > 30
    ]
    windows = [w for w in windows if w["w"] <= 200 and w["h"] <= 200]

    # --- двери: тёмные полоски у стен коридора (пересечение полосок) ---
    doors = []
    if corridor:
        dark_nw = m["dark"] & ~(m["gray"] | m["orange"])
        for label, wy0, wy1 in [
            ("top", corridor["y"] - 25, corridor["y"] - 1),
            ("mid", corridor["y"] + corridor["h"] - 2, corridor["y"] + corridor["h"] + 12),
        ]:
            reg = dark_nw[wy0 : wy1 + 1, x0 : x1 + 1].sum(axis=0)
            for s, p in clusters((reg > 4).astype(int), 6, min_len=3):
                w = p - s
                if 5 <= w <= 25 and x0 + 30 < x0 + s and x0 + p < x1 - 30:
                    doors.append({"x": int(x0 + s), "w": int(w), "wall": label, "y": int(wy0)})

    result = {
        "bounds": {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0},
        "walls_h": hwalls,
        "rooms": rooms,
        "corridor": corridor,
        "windows": windows,
        "doors": doors,
    }
    if out:
        with open(out, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f"сохранено: {out}")
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    main(args.image, args.out)
