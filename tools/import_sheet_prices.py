"""Đồng bộ bảng giá biển số ô tô từ Google Sheet của chủ web vào assets/gia.json.

Nguồn Google Sheet:
  https://docs.google.com/spreadsheets/d/1K8Sh7k_0a0fA5wCw6igwDbKpKIJgqPSrgWXdagwHObA/edit?gid=0
Cấu trúc cột:
  - Cột 1 (index 0): 5 số cuối biển số (00001 -> 99999)
  - Cột 2 (index 1): Giá biển Hà Nội (đơn vị: triệu đồng; -1 hoặc 'Liên hệ' = Liên hệ)
  - Cột 3 (index 2): Giá biển TP.HCM và biển các tỉnh (đơn vị: triệu đồng; -1 hoặc 'Liên hệ' = Liên hệ)

Chạy:
  python tools/import_sheet_prices.py [--csv path/to/file.csv] [--out assets/gia.json] [--quiet-if-unchanged]
"""
import argparse
import csv
import datetime
import io
import json
import os
import re
import sys
import urllib.request

SHEET_ID = "1K8Sh7k_0a0fA5wCw6igwDbKpKIJgqPSrgWXdagwHObA"
SHEET_GID = "0"
SHEET_CSV_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={SHEET_GID}"
FLOOR_CAR = 79


def parse_price(raw, default=FLOOR_CAR):
    s = (raw or "").strip()
    if not s or s.startswith("#"):
        return default
    low = s.lower()
    if "liên hệ" in low or "lien he" in low or s == "-1":
        return -1
    # Hỗ trợ cả trường hợp ghi triệu (1300, 910) hoặc ghi đồng (910.000.000)
    cleaned = re.sub(r"[^\d\-]", "", s)
    if not cleaned or cleaned == "-":
        return default
    val = int(cleaned)
    if val < 0:
        return -1
    if val >= 10_000_000:
        val = round(val / 1_000_000)
    return max(FLOOR_CAR, val) if val > 0 else default


def fetch_csv_text(csv_path=None):
    if csv_path:
        with open(csv_path, "r", encoding="utf-8-sig") as f:
            return f.read()
    req = urllib.request.Request(
        SHEET_CSV_URL,
        headers={"User-Agent": "Mozilla/5.0 (compatible; KhoBienPriceSync/1.0)"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8-sig")


def parse_sheet(csv_text):
    reader = csv.reader(io.StringIO(csv_text))
    rows = list(reader)
    if len(rows) < 50_000:
        raise RuntimeError(f"Dữ liệu Google Sheet bất thường (chỉ có {len(rows)} dòng, cần >= 50.000 dòng).")

    sheet_map = {}
    by_head_total = {str(d): 0 for d in range(10)}
    by_head_nonfloor = {str(d): 0 for d in range(10)}
    valid_rows = 0
    ref_errors = []

    for idx, row in enumerate(rows):
        if len(row) < 3:
            continue
        raw_tail = re.sub(r"\D", "", row[0].strip())
        if not raw_tail or len(raw_tail) > 5:
            continue
        tail = raw_tail.zfill(5)
        if tail == "00000":
            continue

        if row[1].strip().startswith("#") or row[2].strip().startswith("#"):
            ref_errors.append((tail, row[1].strip(), row[2].strip()))

        hn = parse_price(row[1], FLOOR_CAR)
        pv = parse_price(row[2], FLOOR_CAR)
        valid_rows += 1

        head_digit = tail[0]
        by_head_total[head_digit] = by_head_total.get(head_digit, 0) + 1
        if hn != FLOOR_CAR or pv != FLOOR_CAR:
            by_head_nonfloor[head_digit] = by_head_nonfloor.get(head_digit, 0) + 1
            sheet_map[tail] = [hn, pv]

    if valid_rows < 50_000:
        raise RuntimeError(f"Số dòng hợp lệ quá ít ({valid_rows}), hủy cập nhật để bảo toàn gia.json.")

    # Nếu cả một dải 10.000 số (vd 80000-89999) đều đang để mặc định 79 (0 số nào khác 79),
    # đánh dấu vào sheet_skip_heads để không vô tình hạ giá các biển VIP (88888, 86868...) xuống 79tr
    # khi chủ web chưa điền xong dải đó. Khi chủ web điền xong dải 8xxxx trên Sheet, danh sách này tự rỗng [].
    skip_heads = [
        d for d in sorted(by_head_total)
        if by_head_total[d] >= 1000 and by_head_nonfloor.get(d, 0) == 0
    ]

    return sheet_map, skip_heads, valid_rows, ref_errors


def update_gia_file(gia_path, sheet_map, skip_heads, quiet_if_unchanged=False):
    with open(gia_path, "r", encoding="utf-8") as f:
        gia = json.load(f)

    old_sheet = gia.get("sheet")
    old_skip = gia.get("sheet_skip_heads")
    old_min = gia.get("sheet_min")

    if quiet_if_unchanged and old_sheet == sheet_map and old_skip == skip_heads and old_min == FLOOR_CAR:
        print(f"Bảng giá Google Sheet không thay đổi ({len(sheet_map)} đuôi vượt sàn) -> giữ nguyên {gia_path}")
        return False

    tz_vn = datetime.timezone(datetime.timedelta(hours=7))
    now = datetime.datetime.now(tz_vn)

    gia["sheet"] = sheet_map
    gia["sheet_min"] = FLOOR_CAR
    gia["sheet_skip_heads"] = skip_heads
    gia["sheet_id"] = SHEET_ID
    gia["sheet_updated"] = now.strftime("%d/%m/%Y %H:%M")
    gia["updated"] = now.strftime("%d/%m/%Y")

    with open(gia_path, "w", encoding="utf-8") as f:
        json.dump(gia, f, ensure_ascii=False, separators=(",", ":"))

    print(
        f"Đã cập nhật {gia_path}: {len(sheet_map)} đuôi vượt sàn {FLOOR_CAR}tr "
        f"(skip_heads={skip_heads}) lúc {gia['sheet_updated']}"
    )
    return True


def main():
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    default_out = os.path.join(repo_root, "assets", "gia.json")

    ap = argparse.ArgumentParser(description="Đồng bộ bảng giá Google Sheet vào assets/gia.json")
    ap.add_argument("--csv", default=None, help="Đường dẫn CSV local (mặc định tải trực tiếp từ Google Sheet)")
    ap.add_argument("--out", default=default_out, help="Đường dẫn file gia.json cần cập nhật")
    ap.add_argument("--quiet-if-unchanged", action="store_true", help="Không ghi lại nếu bảng giá không đổi")
    args = ap.parse_args()

    csv_text = fetch_csv_text(args.csv)
    sheet_map, skip_heads, valid_rows, ref_errors = parse_sheet(csv_text)
    print(f"Đọc thành công {valid_rows} dòng từ Google Sheet ({len(sheet_map)} đuôi có giá > {FLOOR_CAR}tr).")
    if ref_errors:
        print(f"Cảnh báo: phát hiện {len(ref_errors)} dòng lỗi công thức trên Sheet (đã gán tạm {FLOOR_CAR}tr): {ref_errors[:5]}")
    if skip_heads:
        print(f"Cảnh báo: dải đầu số {skip_heads}xxxx trên Sheet hiện có 0 biển vượt sàn {FLOOR_CAR}tr -> tạm dùng logic dự phòng cho dải này.")

    update_gia_file(args.out, sheet_map, skip_heads, quiet_if_unchanged=args.quiet_if_unchanged)


if __name__ == "__main__":
    main()
