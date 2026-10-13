"""Đọc mọi file .xlsx trong thư mục vpa/ (file phiên VPA hoặc file kho), xuất dữ liệu gọn vào vpa-data/.
Định dạng: mỗi nguồn 1 file JSON {"name","kind","groups":{"<tiền tố>":{"p":tỉnh,"n":"5 số liền nhau..."}}}
"""
import json, os, re, sys, glob, datetime, unicodedata
import openpyxl

SRC = sys.argv[1] if len(sys.argv) > 1 else "vpa"
OUT = sys.argv[2] if len(sys.argv) > 2 else "vpa-data"
RE = re.compile(r"^(\d{2})([A-Z]{1,2})(\d{4,5})$")
YELLOW = {"H", "E"}  # seri biển vàng (kinh doanh vận tải) — không đưa lên web

def norm(v):
    s = re.sub(r"[^0-9A-Z]", "", str(v or "").upper())
    m = RE.match(s)
    if not m: return None
    code, ser, num = m.groups()
    return code + ser, num.zfill(5)

def slug(s):
    s = unicodedata.normalize("NFD", s.replace("đ", "d").replace("Đ", "D"))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^0-9A-Za-z]+", "-", s).strip("-").lower()
    return s or "nguon"

def add(groups, key, num, prov):
    g = groups.setdefault(key, {"p": prov or "", "n": []})
    if prov and not g["p"]: g["p"] = prov
    g["n"].append(num)

def kind_of(sheet, fname):
    t = (sheet + " " + fname).lower()
    if "vàng" in t or "vang" in t: return "car_yellow"
    if "mô tô" in t or "moto" in t or "xe máy" in t: return "moto"
    return "car"

def read_file(path):
    fname = os.path.basename(path)
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sources = []
    for ws in wb.worksheets:
        rows = ws.iter_rows(values_only=True)
        first = next(rows, None)
        if first is None: continue
        if kind_of(ws.title, fname) == "car_yellow": continue  # bỏ sheet biển vàng
        head = [str(x or "").strip().lower() for x in first]
        groups, session = {}, ""
        if "biển số" in head:
            ib = head.index("biển số")
            ip = head.index("địa phương") if "địa phương" in head else None
            iph = head.index("phiên") if "phiên" in head else None
            iy = head.index("năm") if "năm" in head else None
            for r in rows:
                x = norm(r[ib] if ib < len(r) else None)
                if not x or x[0][2:] in YELLOW: continue
                if not session and iph is not None and r[iph]:
                    session = f"Phiên {r[iph]}" + (f"/{r[iy]}" if iy is not None and r[iy] else "")
                add(groups, x[0], x[1], r[ip] if ip is not None else "")
        else:
            for r in [first, *rows]:
                x = norm(r[0] if r else None)
                if x and x[0][2:] not in YELLOW: add(groups, x[0], x[1], "")
        if not groups: continue
        k = kind_of(ws.title, fname)
        label = session or ("Kho VPA" if "kho" in fname.lower() else os.path.splitext(fname)[0])
        name = f"{label} – " + {"car": "Ô tô", "car_yellow": "Ô tô vàng", "moto": "Xe máy"}[k]
        if ws.title.lower().startswith("ô tô - trắng"): name = f"{label} – Ô tô trắng"
        for g in groups.values():
            g["n"] = "".join(sorted(set(g["n"])))
        total = sum(len(g["n"]) // 5 for g in groups.values())
        sources.append({"name": name, "kind": k, "file": fname, "count": total, "groups": groups})
    return sources

def main():
    os.makedirs(OUT, exist_ok=True)
    files = sorted(glob.glob(os.path.join(SRC, "*.xlsx")))
    if not files: print("Không có file .xlsx trong", SRC); return
    index = []
    for f in os.listdir(OUT):
        if f.endswith(".json"): os.remove(os.path.join(OUT, f))
    for path in files:
        for s in read_file(path):
            fid = slug(s["name"])
            with open(os.path.join(OUT, fid + ".json"), "w", encoding="utf-8") as fh:
                json.dump({"name": s["name"], "kind": s["kind"], "groups": s["groups"]}, fh, ensure_ascii=False, separators=(",", ":"))
            index.append({"id": fid, "name": s["name"], "kind": s["kind"], "count": s["count"], "file": s["file"]})
            print(f"{s['name']}: {s['count']:,} biển")
    meta = {"updated": datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=7))).strftime("%H:%M %d/%m/%Y"), "sources": index}
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=1)

if __name__ == "__main__":
    main()
