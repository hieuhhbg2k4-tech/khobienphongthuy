"""Tính giá tham khảo cho biển ô tô và xe máy theo lịch sử trúng đấu giá VPA của cùng 5 số cuối.

Đầu vào : JSON {"55255": [[giá HN...], [giá tỉnh khác...]], ...}  (đơn vị: triệu đồng)
          lấy từ VPA: /search-api/search/statistic-winner-price-history (siteId=1 ô tô, siteId=2 xe máy)
Chạy    : python tools/build_gia.py lich_su_oto.json lich_su_xemay.json assets/gia.json
Đầu ra  : assets/gia.json  {"updated": "...", "min": 79, "contact": 1500, "t": {...},      <- ô tô
                            "m": {"min": 15, "contact": 1500, "t": {...}}}                <- xe máy
          "t": {"55255": [giá biển Hà Nội, giá biển tỉnh], ...}; giá = -1 nghĩa là "Liên hệ";
          đuôi không có trong "t" thì dùng giá sàn (min).

Quy tắc (chỉnh ở phần CẤU HÌNH):
  - Nhóm so sánh: biển Hà Nội so với lịch sử Hà Nội (nếu có >= 2 kết quả, không thì so với tất cả);
    biển tỉnh so với lịch sử các tỉnh (không tính Hà Nội; nếu không có thì so với tất cả).
  - Giá = mức P75 (phân vị 75%) của nhóm × 1,1, làm tròn lên bậc đẹp; không thấp hơn giá sàn.
  - Giá tính ra >= 1,5 tỷ  ->  "Liên hệ".
"""
import json, math, sys, datetime

# ===== CẤU HÌNH =====
CAR = {"min": 79, "contact": 1500, "step5": False}   # ô tô: giá sàn 79 tr
MOTO = {"min": 15, "contact": 1500, "step5": True}   # xe máy: giá sàn 15 tr, dưới 100 tr làm tròn bội 5
MARKUP = 1.1
PCT = 0.75

def pct(vals, q):
    v = sorted(vals)
    if not v: return None
    k = (len(v) - 1) * q
    f = math.floor(k); c = min(f + 1, len(v) - 1)
    return v[f] + (v[c] - v[f]) * (k - f)

def nice(x, cfg):
    """Làm tròn lên bậc giá dễ đọc: (<100 -> bội 5 nếu step5), <200 -> bội 10, <1000 -> bội 50, còn lại bội 100."""
    if x <= cfg["min"]: return cfg["min"]
    if cfg["step5"] and x < 100: return int(math.ceil(x / 5.0) * 5)
    if x < 200: return int(math.ceil(x / 10.0) * 10)
    if x < 1000: return int(math.ceil(x / 50.0) * 50)
    return int(math.ceil(x / 100.0) * 100)

def price(group, allv, cfg):
    if not group: group = allv
    if not group: return cfg["min"]
    return max(cfg["min"], nice(pct(group, PCT) * MARKUP, cfg))

def build(data, cfg):
    t = {}
    for tail, (hn, pv) in data.items():
        allv = hn + pv
        if not allv: continue
        a = price(hn if len(hn) >= 2 else allv, allv, cfg)
        b = price(pv, allv, cfg)
        if a >= cfg["contact"]: a = -1
        if b >= cfg["contact"]: b = -1
        if a != cfg["min"] or b != cfg["min"]:
            t[tail] = [a, b]
    return t

def main(car_src, moto_src, out):
    car = build(json.load(open(car_src, encoding="utf-8")), CAR)
    res = {"updated": datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=7))).strftime("%d/%m/%Y"),
           "min": CAR["min"], "contact": CAR["contact"], "t": car}
    if moto_src:
        moto = build(json.load(open(moto_src, encoding="utf-8")), MOTO)
        res["m"] = {"min": MOTO["min"], "contact": MOTO["contact"], "t": moto}
        print(f"Xe máy: {len(moto)} đuôi có giá riêng / liên hệ")
    json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"Ô tô: {len(car)} đuôi có giá riêng / liên hệ -> {out}")

if __name__ == "__main__":
    a = sys.argv[1:]
    main(a[0], a[1] if len(a) > 1 else None, a[2] if len(a) > 2 else "assets/gia.json")
