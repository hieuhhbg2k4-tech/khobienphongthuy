"""Tính giá tham khảo cho biển ô tô theo lịch sử trúng đấu giá VPA của cùng 5 số cuối.

Đầu vào : JSON {"55255": [[giá HN...], [giá tỉnh khác...]], ...}  (đơn vị: triệu đồng)
          lấy từ VPA: /search-api/search/statistic-winner-price-history (siteId=1, ô tô)
Đầu ra  : assets/gia.json  {"updated": "...", "min": 79, "contact": 1500,
                               "t": {"55255": [giá HN, giá tỉnh], ...}}
          giá = -1 nghĩa là "Liên hệ"; đuôi không có trong "t" thì dùng giá sàn (min).

Quy tắc (có thể chỉnh ở phần CẤU HÌNH):
  - Nhóm so sánh: biển Hà Nội so với lịch sử Hà Nội (nếu có >= 2 kết quả, không thì so với tất cả);
    biển tỉnh so với lịch sử các tỉnh (không tính Hà Nội; nếu không có thì so với tất cả).
  - Giá = mức P75 (phân vị 75%) của nhóm × 1,1, làm tròn lên bậc đẹp; không thấp hơn giá sàn 79 tr.
  - Giá tính ra >= 1,5 tỷ  ->  "Liên hệ".
"""
import json, math, sys, datetime

MIN_PRICE = 79        # triệu — giá sàn
CONTACT_FROM = 1500   # triệu — từ mức này hiển thị "Liên hệ"
MARKUP = 1.1
PCT = 0.75

def pct(vals, q):
    v = sorted(vals)
    if not v: return None
    k = (len(v) - 1) * q
    f = math.floor(k); c = min(f + 1, len(v) - 1)
    return v[f] + (v[c] - v[f]) * (k - f)

def nice(x):
    """Làm tròn lên bậc giá dễ đọc: <200 -> bội 10, <1000 -> bội 50, còn lại bội 100."""
    if x <= MIN_PRICE: return MIN_PRICE
    if x < 200: return int(math.ceil(x / 10.0) * 10)
    if x < 1000: return int(math.ceil(x / 50.0) * 50)
    return int(math.ceil(x / 100.0) * 100)

def price(group, allv):
    if not group: group = allv
    if not group: return MIN_PRICE
    return max(MIN_PRICE, nice(pct(group, PCT) * MARKUP))

def main(src, out):
    data = json.load(open(src, encoding="utf-8"))
    t = {}
    for tail, (hn, pv) in data.items():
        allv = hn + pv
        if not allv: continue
        a = price(hn if len(hn) >= 2 else allv, allv)
        b = price(pv, allv)
        if a >= CONTACT_FROM: a = -1
        if b >= CONTACT_FROM: b = -1
        if a != MIN_PRICE or b != MIN_PRICE:
            t[tail] = [a, b]
    res = {"updated": datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=7))).strftime("%d/%m/%Y"),
           "min": MIN_PRICE, "contact": CONTACT_FROM, "t": t}
    json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"{len(data)} đuôi có lịch sử -> {len(t)} đuôi có giá riêng / liên hệ")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "assets/gia.json")
