"""Lấy lịch đấu giá + hạn đăng ký từ VPA (dgbs.vpa.com.vn) và gắn vào vpa-data/live.json.

Sheet BIENSOVP không còn điền ngày đấu cho các phiên mới, nên bước này hỏi thẳng VPA:
  POST /search-api/search/list-announcement-plan  {auctionDate:"dd/MM/yyyy", siteId:1|2, offset, limit:25}
Mỗi biển có lịch được ghi ngày đấu (cột 4) và số người đăng ký (cột 5) vào live.json;
biển có lịch mà chưa có trong live.json thì thêm vào. Hạn đăng ký của từng ngày lưu ở live["reg_end"].

Chạy: python tools/vpa_lich.py vpa-data/live.json [số ngày tới, mặc định 21]
"""
import json, sys, time, datetime, urllib.request, concurrent.futures as cf

API = "https://dgbs.vpa.com.vn/search-api/search/list-announcement-plan"
PAGE = 25          # VPA chỉ trả tối đa 25 biển mỗi lần
WORKERS = 3        # số yêu cầu song song (nhẹ tay với máy chủ VPA)

def post(body, tries=4):
    data = json.dumps(body).encode()
    for k in range(tries):
        try:
            req = urllib.request.Request(API, data=data, headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (khobienphongthuy.vn lich-dau-gia)"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if k == tries - 1: raise
            time.sleep(2 * (k + 1))

def body(date, site, offset):
    return {"offset": offset, "limit": PAGE, "province": "", "vehicle": "", "colorCode": -1, "license_plate": "",
            "auctionDate": date, "announcementNumber": "", "siteId": site}

def main():
    path = sys.argv[1]; days = int(sys.argv[2]) if len(sys.argv) > 2 else 21
    live = json.load(open(path, encoding="utf-8"))
    rows = live.get("rows") or []
    now = datetime.datetime.utcnow() + datetime.timedelta(hours=7)
    found, reg_end, plan = {}, {}, []
    try:
        for k in range(-1, days + 1):
            d = (now + datetime.timedelta(days=k)).strftime("%d/%m/%Y")
            for site in (1, 2):
                first = post(body(d, site, 0))
                total = first.get("totalElements") or 0
                if not total: continue
                plan.append((d, site, total))
                for x in first.get("content") or []: found[x["bks"]] = (x, site)
                print(f"{d} site{site}: {total} biển", flush=True)
        with cf.ThreadPoolExecutor(WORKERS) as ex:
            futs = {ex.submit(post, body(d, site, off)): site for d, site, total in plan for off in range(PAGE, total, PAGE)}
            for f in cf.as_completed(futs):
                for x in (f.result().get("content") or []):
                    found[x["bks"]] = (x, futs[f])
    except Exception as e:
        print("Không lấy được lịch từ VPA:", e)
        if len(found) < 100: sys.exit(0)   # VPA lỗi -> giữ nguyên file
    for bks, (x, site) in found.items():
        if x.get("auctionDate") and x.get("timeEndRegister"):
            dd, mm, yy = x["auctionDate"].split("/")
            reg_end[yy + mm + dd] = x["timeEndRegister"]
    idx = {str(r[0]).upper(): r for r in rows}
    upd = add = 0
    for bks, (x, site) in found.items():
        date = x.get("auctionDate") or ""
        cnt = x.get("totalRegisteringPeople")
        r = idx.get(bks.upper())
        if r is not None:
            r[3] = date
            if isinstance(cnt, int): r[4] = cnt
            upd += 1
        else:
            rows.append([bks, 0, 1 if site == 2 else 0, date, cnt if isinstance(cnt, int) else -1]); add += 1
    live["rows"] = rows; live["count"] = len(rows)
    live["reg_end"] = reg_end
    live["lich_updated"] = now.strftime("%H:%M %d/%m/%Y")
    json.dump(live, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"OK: {len(found)} biển có lịch ({upd} cập nhật, {add} thêm mới); hạn đăng ký: {reg_end}")

if __name__ == "__main__":
    main()
