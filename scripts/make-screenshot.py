"""Render a storefront screenshot of the delete-confirmation dialog.

This is a faithful rendition of what `client.js` draws — same copy, same layout
proportions, same colours — so the marketplace tile shows the real surface
instead of a mockup that lies about it.
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = "assets"
W, H = 1280, 800

BG = (247, 248, 250)
SIDEBAR = (240, 241, 244)
PANEL = (255, 255, 255)
TEXT = (31, 35, 40)
MUTED = (107, 114, 128)
BORDER = (222, 225, 230)
DANGER = (217, 45, 32)
OVERLAY_ALPHA = 110


def load_font(size, bold=False):
    """Pick a font that exists on Windows, falling back to the bitmap default."""
    candidates = (
        ["C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/msyhbd.ttc"] if bold
        else ["C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/msyh.ttc"]
    )
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def rounded(draw, box, radius, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def main():
    os.makedirs(OUT, exist_ok=True)
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img, "RGBA")

    f_row = load_font(15)
    f_row_muted = load_font(13)
    f_title = load_font(19, bold=True)
    f_body = load_font(15)
    f_small = load_font(12)
    f_btn = load_font(14, bold=True)

    # ── sidebar of session rows ────────────────────────────────────────────────
    d.rectangle([0, 0, 300, H], fill=SIDEBAR)
    d.text((24, 26), "default-workspace", font=f_title, fill=TEXT)
    rows = [
        "Delete a session", "Plugin market install", "Vision router setup",
        "Purge migration", "Blender modelling", "Windows MCP bridge",
        "WorkBuddy connect", "Agent compare run",
    ]
    y = 76
    active_index = 0
    for i, label in enumerate(rows):
        if i == active_index:
            rounded(d, [12, y - 8, 288, y + 30], 8, fill=(226, 232, 244))
        d.ellipse([28, y + 4, 38, y + 14], fill=(160, 168, 180))
        d.text((50, y), label, font=f_row, fill=TEXT if i == active_index else MUTED)
        y += 46
    # the right-click target, highlighted
    d.rectangle([12, 68, 288, 106], outline=(76, 141, 255), width=2)

    # ── scrim + dialog ────────────────────────────────────────────────────────
    scrim = Image.new("RGBA", (W, H), (0, 0, 0, OVERLAY_ALPHA))
    img = Image.alpha_composite(img.convert("RGBA"), scrim).convert("RGB")
    d = ImageDraw.Draw(img, "RGBA")

    pw, ph = 560, 330
    px, py = (W - pw) // 2 + 60, (H - ph) // 2
    d.rectangle([px + 4, py + 10, px + pw + 4, py + ph + 10], fill=(0, 0, 0, 40))
    rounded(d, [px, py, px + pw, py + ph], 12, fill=PANEL, outline=BORDER)

    pad = 22
    d.text((px + pad, py + pad), "Delete this session?", font=f_title, fill=TEXT)

    body = ("The log for \u201cDelete a session\u201d is removed from disk:\n"
            "messages, tool output and the saved title all go with it,\n"
            "and this cannot be undone. To hide the row instead, use Archive.")
    d.multiline_text((px + pad, py + pad + 34), body, font=f_body, fill=TEXT, spacing=6)

    log_y = py + pad + 34 + 84
    d.text((px + pad, log_y), "On disk:", font=f_small, fill=MUTED)
    d.text((px + pad + 6, log_y + 20),
           r"C:\Users\you\.dsh\sessions\--workspace--\session-4f2a...",
           font=f_small, fill=MUTED)

    # running-work warning line, the way the dialog shows it
    warn_y = log_y + 56
    rounded(d, [px + pad, warn_y, px + pw - pad, warn_y + 34], 6, fill=(253, 235, 233))
    d.text((px + pad + 10, warn_y + 8), "This session is still running. Stop it before deleting.",
           font=f_small, fill=DANGER)

    # buttons
    by = py + ph - 62
    bw, bh = 92, 38
    cancel_x = px + pw - pad - bw * 2 - 12
    rounded(d, [cancel_x, by, cancel_x + bw, by + bh], 8, fill=PANEL, outline=(198, 203, 210))
    d.text((cancel_x + 26, by + 11), "Cancel", font=f_btn, fill=TEXT)

    confirm_x = px + pw - pad - bw
    rounded(d, [confirm_x, by, confirm_x + bw, by + bh], 8, fill=DANGER)
    d.text((confirm_x + 21, by + 11), "Delete", font=f_btn, fill=(255, 255, 255))

    # ── the context menu that opened it, behind the scrim ────────────────────
    mx, my = 96, 150
    menu_w = 190
    items = [
        ("Pin session", False), ("Rename", False), ("Fork", False),
        ("Copy session ID", False), ("Archive session", False), ("Delete session", True),
    ]
    menu_h = 18 + len(items) * 32 + 12
    rounded(d, [mx, my, mx + menu_w, my + menu_h], 10, fill=PANEL, outline=BORDER)
    iy = my + 14
    for label, danger in items:
        if danger:
            d.line([mx + 8, iy - 6, mx + menu_w - 8, iy - 6], fill=BORDER)
            rounded(d, [mx + 6, iy - 2, mx + menu_w - 6, iy + 26], 6, fill=(253, 235, 233))
        d.text((mx + 16, iy + 2), label, font=f_row, fill=DANGER if danger else TEXT)
        iy += 32

    img.save(os.path.join(OUT, "screenshot-dialog.png"))
    print("wrote assets/screenshot-dialog.png", img.size)


if __name__ == "__main__":
    main()
