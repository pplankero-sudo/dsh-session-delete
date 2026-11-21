"""Generate the marketplace icon for dsh-session-delete.

Draws a conversation bubble with a trash glyph, at 512px and a 180px storefront
tile. Flat vector-style shapes, no external fonts, so the PNG is reproducible.
"""
from PIL import Image, ImageDraw

OUT = "assets"
BG_TOP = (76, 141, 255)      # DSH blue
BG_BOTTOM = (58, 110, 214)
BUBBLE = (255, 255, 255)
GLYPH = (217, 45, 32)        # destructive red
GLYPH_DARK = (150, 26, 18)


def vertical_gradient(size, top, bottom):
    """Return an RGBA image with a top-to-bottom linear gradient."""
    img = Image.new("RGB", (1, size))
    px = img.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        px[0, y] = (
            round(top[0] + (bottom[0] - top[0]) * t),
            round(top[1] + (bottom[1] - top[1]) * t),
            round(top[2] + (bottom[2] - top[2]) * t),
        )
    return img.resize((size, size), Image.NEAREST).convert("RGBA")


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def draw_icon(size):
    """Compose one square icon at the given pixel size."""
    scale = 4  # draw large, downsample for clean edges
    s = size * scale
    img = vertical_gradient(s, BG_TOP, BG_BOTTOM)
    d = ImageDraw.Draw(img)

    unit = s / 100.0

    # conversation bubble (rounded rect + tail)
    bx0, by0, bx1, by1 = 20 * unit, 20 * unit, 80 * unit, 66 * unit
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=9 * unit, fill=BUBBLE)
    d.polygon([
        (34 * unit, 64 * unit),
        (34 * unit, 78 * unit),
        (50 * unit, 66 * unit),
    ], fill=BUBBLE)

    # trash can glyph inside the bubble
    cx = 50 * unit
    lid_y = 34 * unit
    d.rounded_rectangle(
        [cx - 13 * unit, lid_y - 4 * unit, cx + 13 * unit, lid_y + 1.5 * unit],
        radius=2 * unit, fill=GLYPH,
    )
    d.rounded_rectangle(
        [cx - 4.5 * unit, lid_y - 8 * unit, cx + 4.5 * unit, lid_y - 3 * unit],
        radius=1.6 * unit, fill=GLYPH,
    )
    # body: slightly tapered
    d.polygon([
        (cx - 10 * unit, lid_y + 4 * unit),
        (cx + 10 * unit, lid_y + 4 * unit),
        (cx + 7.5 * unit, lid_y + 22 * unit),
        (cx - 7.5 * unit, lid_y + 22 * unit),
    ], fill=GLYPH)
    # lid shadow line
    d.rectangle([cx - 10 * unit, lid_y + 4 * unit, cx + 10 * unit, lid_y + 5.2 * unit], fill=GLYPH_DARK)
    # three ribs
    for dx in (-4, 0, 4):
        d.rounded_rectangle(
            [cx + dx * unit - 0.9 * unit, lid_y + 8 * unit,
             cx + dx * unit + 0.9 * unit, lid_y + 18.5 * unit],
            radius=0.9 * unit, fill=GLYPH_DARK,
        )

    img = img.resize((size, size), Image.LANCZOS)
    mask = rounded_mask(size, int(size * 0.22))
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def main():
    import os
    os.makedirs(OUT, exist_ok=True)
    icon = draw_icon(512)
    icon.save(os.path.join(OUT, "icon.png"))
    icon.resize((180, 180), Image.LANCZOS).save(os.path.join(OUT, "icon-180.png"))
    icon.resize((96, 96), Image.LANCZOS).save(os.path.join(OUT, "icon-96.png"))
    print("wrote assets/icon.png, assets/icon-180.png, assets/icon-96.png")


if __name__ == "__main__":
    main()
