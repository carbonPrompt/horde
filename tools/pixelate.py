"""Turn a generated sprite (single object on a flat magenta background) into game pixel art.
python3 tools/pixelate.py IN.png OUT.png [--size 64] [--colors 24]
Keys out the background, crops to the object, pads square, downsamples with box filtering and snaps to a small
palette with hard 1-bit transparency, then adds a 1 px dark outline so it reads on any map color."""
import argparse
import numpy as np
from PIL import Image


def key_background(im: Image.Image) -> Image.Image:
    a = np.asarray(im.convert("RGB")).astype(np.int32)
    h, w, _ = a.shape
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(border, axis=0)                      # the flat background color, sampled from the edges
    dist = np.sqrt(((a - bg) ** 2).sum(axis=2))
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    magenta = (r > g + 50) & (b > g + 30)                # the background's cast shadow and fringes (no army is pink)
    alpha = np.where((dist > 70) & ~magenta, 255, 0).astype(np.uint8)
    out = np.dstack([a.astype(np.uint8), alpha])
    return Image.fromarray(out, "RGBA")


def pixelate(src: str, dst: str, size: int, colors: int):
    im = key_background(Image.open(src))
    box = im.getchannel("A").getbbox()
    if not box:
        raise SystemExit(f"{src}: nothing left after removing the background")
    im = im.crop(box)
    side = int(max(im.size) * 1.06)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    inner = size - 2                                       # room for the outline
    small = sq.resize((inner, inner), Image.Resampling.BOX)
    arr = np.asarray(small).copy()
    solid = arr[:, :, 3] >= 128
    rgb = Image.fromarray(arr[:, :, :3], "RGB").quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")
    q = np.asarray(rgb)
    out = np.zeros((size, size, 4), np.uint8)
    out[1:-1, 1:-1, :3] = q
    out[1:-1, 1:-1, 3] = np.where(solid, 255, 0)
    # outline: transparent pixels touching a solid one become near-black
    a = out[:, :, 3] > 0
    ring = np.zeros_like(a)
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        ring |= np.roll(np.roll(a, dy, 0), dx, 1)
    ring &= ~a
    out[ring] = (10, 13, 18, 255)
    Image.fromarray(out, "RGBA").save(dst)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("src"); p.add_argument("dst"); p.add_argument("--size", type=int, default=64); p.add_argument("--colors", type=int, default=24)
    a = p.parse_args()
    pixelate(a.src, a.dst, a.size, a.colors)
