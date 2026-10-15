"""Tải ảnh giao diện từ bienxeoto.vn về assets/bx/, nén sang WebP cho nhẹ (giữ tên, đổi đuôi .webp)."""
import pathlib, sys, urllib.request, io
from PIL import Image

out = pathlib.Path("assets/bx"); out.mkdir(parents=True, exist_ok=True)
fail = []
for line in pathlib.Path("tools/bx-assets.txt").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#"): continue
    url, name = line.split()
    try:
        raw = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=60).read()
        im = Image.open(io.BytesIO(raw))
        stem = pathlib.Path(name).stem
        if im.width > 1600:  # banner rộng -> thu về 1600px
            im = im.resize((1600, round(im.height * 1600 / im.width)), Image.LANCZOS)
        if im.mode not in ("RGB", "RGBA"): im = im.convert("RGBA")
        im.save(out / f"{stem}.webp", "WEBP", quality=80, method=6)
        print("OK", name, im.size, (out / f"{stem}.webp").stat().st_size // 1024, "KB")
    except Exception as e:
        fail.append(f"{url}: {e}"); print("LOI", url, e)
print("Loi:", len(fail)); sys.exit(1 if len(fail) > 5 else 0)
