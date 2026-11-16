"""Tính giá tham khảo cho biển ô tô và xe máy theo lịch sử trúng đấu giá VPA của cùng 5 số cuối.

Đầu vào : JSON {"55255": [[giá HN...], [giá tỉnh khác...]], ...}  (đơn vị: triệu đồng)
          lấy từ VPA: /search-api/search/statistic-winner-price-history (siteId=1 ô tô, siteId=2 xe máy)
Chạy    : python tools/build_gia.py lich_su_oto.json lich_su_xemay.json assets/gia.json [gia_khobienvietnam.json]
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

# ===== Giá theo khobienvietnam.com (giá niêm yết từng biển) + mức cộng thêm =====
def _r(x): return int(math.floor(x + 0.5))   # làm tròn .5 lên (giống Math.round trên web)

def kbvn_markup(p):
    """p: giá niêm yết bên khobienvietnam (triệu). Trả về giá bán trên web, -1 = Liên hệ.
    Quy tắc:
      - p >= 1000: Liên hệ (-1)
      - p >= 200: markup +20% (* 1.20)
      - p <= 195: markup +30% (* 1.30)
      - 195 < p < 200: chuyển tiếp (* 1.25)
      - Làm tròn lên đuôi 9 (vd 176 -> 179, 130 -> 139)
    """
    if p is None or p < 0: return p
    if p >= 1000: return -1                                   # từ 1 tỷ: Liên hệ
    if p >= 200:
        marked = p * 1.20
    elif p <= 195:
        marked = p * 1.30
    else:
        marked = p * 1.25                                     # 195–200 tr: chuyển tiếp
    v = _r(marked)
    d = v % 10
    return v if d == 9 else v - d + 9

def main(car_src, moto_src, out, kbvn_src=None):
    car = build(json.load(open(car_src, encoding="utf-8")), CAR)
    res = {"updated": datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=7))).strftime("%d/%m/%Y"),
           "min": CAR["min"], "contact": CAR["contact"], "t": car}
    if moto_src:
        moto = build(json.load(open(moto_src, encoding="utf-8")), MOTO)
        res["m"] = {"min": MOTO["min"], "contact": MOTO["contact"], "t": moto}
        print(f"Xe máy: {len(moto)} đuôi có giá riêng / liên hệ")
    if kbvn_src:
        # {"30N13658": [giá đồng, "car"|"moto", nguồn], ...}  — chỉ các biển giá >= 100 tr
        kb = json.load(open(kbvn_src, encoding="utf-8"))
        res["p"] = {k: kbvn_markup(v[0] / 1e6) for k, v in kb.items() if v and v[0]}
        # Giá gốc khobienvietnam (triệu, -1 = từ 1 tỷ). Web bán = max(giá lịch sử VPA, giá này x 1,1)
        res["k"] = {k: (-1 if v[0] >= 1e9 else round(v[0] / 1e6)) for k, v in kb.items() if v and v[0]}
        res["car_kbvn"] = True   # ô tô: chỉ dùng giá khobienvietnam (không có trong danh sách = giá sàn)
        print(f"Giá theo khobienvietnam: {len(res['p'])} biển")
    json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"Ô tô: {len(car)} đuôi có giá riêng / liên hệ -> {out}")

if __name__ == "__main__":
    a = sys.argv[1:]
    main(a[0], a[1] if len(a) > 1 else None, a[2] if len(a) > 2 else "assets/gia.json", a[3] if len(a) > 3 else None)
