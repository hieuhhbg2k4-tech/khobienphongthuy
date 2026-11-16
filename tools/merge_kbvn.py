import json
import datetime
import math

def _r(x):
    return int(math.floor(x + 0.5))

def kbvn_markup(p):
    """
    Price markup rules for KBVN:
    - p >= 1000: Liên hệ (-1)
    - p >= 200: markup +20% (* 1.20)
    - p <= 195: markup +30% (* 1.30)
    - 195 < p < 200: transitional (* 1.25)
    - Round up to end in 9 (e.g. 176 -> 179, 130 -> 139)
    """
    if p is None or p < 0:
        return p
    if p >= 1000:
        return -1
    if p >= 200:
        marked = p * 1.20
    elif p <= 195:
        marked = p * 1.30
    else:
        marked = p * 1.25
    v = _r(marked)
    d = v % 10
    return v if d == 9 else v - d + 9

def main():
    gia_path = r"c:\Users\Administrator\Projects\khobienphongthuy\assets\gia.json"
    scraped_path = r"c:\Users\Administrator\Projects\khobienphongthuy\tools\kbvn_scraped.json"

    with open(gia_path, "r", encoding="utf-8") as f:
        gia = json.load(f)

    with open(scraped_path, "r", encoding="utf-8") as f:
        scraped = json.load(f)

    print(f"Existing gia['k'] count: {len(gia.get('k', {}))}")
    print(f"Scraped count: {len(scraped)}")

    k = gia.setdefault("k", {})
    new_plates = 0
    updated_plates = 0

    for plate, price in scraped.items():
        if plate not in k:
            new_plates += 1
            k[plate] = price
        else:
            if k[plate] != price:
                updated_plates += 1
                k[plate] = price

    print(f"New plates added: {new_plates}")
    print(f"Existing plates updated: {updated_plates}")
    print(f"Total gia['k'] count now: {len(k)}")

    # Recalculate gia['p'] based on new markup formula
    p_dict = {}
    for plate, price in k.items():
        if price is not None:
            p_dict[plate] = kbvn_markup(price)
    gia["p"] = p_dict
    print(f"Total gia['p'] recalculated: {len(p_dict)}")

    now_str = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=7))).strftime("%d/%m/%Y %H:%M")
    gia["k_updated"] = now_str
    gia["updated"] = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=7))).strftime("%d/%m/%Y")

    with open(gia_path, "w", encoding="utf-8") as f:
        json.dump(gia, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Successfully saved updated {gia_path}")

if __name__ == "__main__":
    main()
