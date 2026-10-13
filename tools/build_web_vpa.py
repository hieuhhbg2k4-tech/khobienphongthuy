"""Kéo dữ liệu biển VPA từ Google Sheet BIENSOVP (qua Apps Script Web App) → kho-data/web.json cho trang chủ.

Định dạng web.json: {"updated": "HH:mm dd/MM/yyyy", "count": N, "provs": [tên tỉnh],
                     "rows": [[biển, chỉ số tỉnh, xe máy 0/1, "dd/MM/yyyy" | "", số người ĐK (-1 = ẩn)]]}
An toàn: nếu Sheet trả về quá ít biển (đang xoá/dọn dở) thì KHÔNG ghi đè dữ liệu cũ.
"""
import json, os, re, sys, time, urllib.request

URL = os.environ.get("VPA_EXPORT_URL") or (
    "https://script.google.com/macros/s/"
    "AKfycbxZ8CzcWQ2F88n13o1xJzlQqmOVDflJd33FNNaScQLwrZY71d6unreyrARuy7c77u-w/exec?action=web"
)
OUT = sys.argv[1] if len(sys.argv) > 1 else "kho-data/web.json"
MIN_ROWS = int(os.environ.get("MIN_ROWS", "1000"))
YELLOW = {"H", "E"}  # seri biển vàng — không đưa lên web
MIN_RATIO = float(os.environ.get("MIN_RATIO", "0.5"))  # không chấp nhận giảm quá 50% so với lần trước


def fetch():
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(URL, headers={"User-Agent": "khobienphongthuy-bot"})
            with urllib.request.urlopen(req, timeout=360) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # Apps Script đôi khi lỗi tạm thời
            last = e
            print(f"Lần {attempt + 1} lỗi: {e}")
            time.sleep(30)
    raise SystemExit(f"Không lấy được dữ liệu: {last}")


def main():
    data = fetch()
    rows = data.get("rows") or []
    def series(plate):
        m = re.match(r"^\d{2}([A-Z]+)\d", str(plate).upper())
        return m.group(1) if m else ""
    before = len(rows)
    rows = [r for r in rows if series(r[0]) not in YELLOW]
    print(f"Bỏ {before - len(rows):,} biển vàng (seri {', '.join(sorted(YELLOW))})")
    n = len(rows)
    print(f"Sheet trả về {n:,} biển, cập nhật {data.get('updated')}")

    old_n = 0
    if os.path.exists(OUT):
        try:
            with open(OUT, encoding="utf-8") as fh:
                old_n = len(json.load(fh).get("rows") or [])
        except Exception:
            pass
    if n < MIN_ROWS:
        print(f"Bỏ qua: ít hơn {MIN_ROWS} biển (Sheet có thể đang được làm mới). Giữ dữ liệu cũ ({old_n:,}).")
        return
    if old_n and n < old_n * MIN_RATIO:
        print(f"Bỏ qua: số biển giảm từ {old_n:,} xuống {n:,} (> {int((1 - MIN_RATIO) * 100)}%). Giữ dữ liệu cũ.")
        return

    out = {"updated": data.get("updated", ""), "count": n, "provs": data.get("provs") or [], "rows": rows}
    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"Đã ghi {OUT}: {n:,} biển, {os.path.getsize(OUT) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
