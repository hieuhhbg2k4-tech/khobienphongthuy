const fs = require('fs');
const path = require('path');

const window = {};
global.window = window;

require(path.join(__dirname, '../assets/kho-engine.js'));
const KE = window.KE;

console.log("KE loaded:", !!KE);
console.log("KE.kbMarkup function exists:", typeof KE.kbMarkup === 'function');
console.log("KE.sheetGia function exists:", typeof KE.sheetGia === 'function');
console.log("KE.setNow function exists:", typeof KE.setNow === 'function');

let failed = 0;
function check(cond, desc) {
  if (!cond) {
    console.error(`FAIL: ${desc}`);
    failed++;
  } else {
    console.log(`PASS: ${desc}`);
  }
}

// 1. Formula unit tests for kbMarkup (used for motorcycles & fallback)
const cases = [
  { in: 100, expected: 139, desc: "100tr -> 130 -> căn 139 (+30%)" },
  { in: 135, expected: 179, desc: "135tr -> 175.5 -> 176 -> căn 179 (+30%)" },
  { in: 195, expected: 259, desc: "195tr -> 253.5 -> 254 -> căn 259 (+30%)" },
  { in: 196, expected: 249, desc: "196tr -> 245 -> căn 249 (transitional 25%)" },
  { in: 200, expected: 249, desc: "200tr -> 240 -> căn 249 (+20%)" },
  { in: 300, expected: 369, desc: "300tr -> 360 -> căn 369 (+20%)" },
  { in: 1000, expected: -1, desc: "1000tr -> -1 (Liên hệ)" },
  { in: -1, expected: -1, desc: "-1 -> -1 (Liên hệ)" }
];

for (const c of cases) {
  const actual = KE.kbMarkup(c.in);
  check(actual === c.expected, `${c.desc} -> got ${actual}`);
}

// 2. Test Google Sheet authoritative pricing in gia.json
const giaData = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/gia.json'), 'utf8'));
KE.setGia(giaData);
console.log("\nLoaded gia.json, sheet non-floor tails:", Object.keys(giaData.sheet || {}).length, "skip_heads:", giaData.sheet_skip_heads);
check(giaData.sheet && Object.keys(giaData.sheet).length > 9000, "gia.json contains >9000 Google Sheet tail entries");

function testPlate(prefix, numStr, moto = 0) {
  const s = new KE.Source({ id: "test", kind: "mix", keepYellow: true, cap: 2 });
  const idx = s.add(prefix, parseInt(numStr, 10), moto);
  const raw = KE.giaOf(s, idx);
  const text = KE.giaText(raw);
  return { raw, text };
}

console.log("\nTesting Google Sheet CAR pricing (Col 2 = Hà Nội, Col 3 = TPHCM & Tỉnh):");
const sheetCarCases = [
  // 00001: Sheet = [1300, 910]
  { prefix: "30K", tail: "00001", expected: 1300, expectedText: "1,3 tỷ", desc: "Hà Nội 30K-000.01 (Cột 2 = 1300)" },
  { prefix: "51K", tail: "00001", expected: 910, expectedText: "910 tr", desc: "TPHCM 51K-000.01 (Cột 3 = 910)" },
  { prefix: "15K", tail: "00001", expected: 910, expectedText: "910 tr", desc: "Hải Phòng 15K-000.01 (Cột 3 = 910)" },
  // 11111: Sheet = [2500, 1750]
  { prefix: "29A", tail: "11111", expected: 2500, expectedText: "2,5 tỷ", desc: "Hà Nội 29A-111.11 (Cột 2 = 2500)" },
  { prefix: "50H", tail: "11111", expected: 1750, expectedText: "1,75 tỷ", desc: "TPHCM 50H-111.11 (Cột 3 = 1750)" },
  { prefix: "37K", tail: "11111", expected: 1750, expectedText: "1,75 tỷ", desc: "Nghệ An 37K-111.11 (Cột 3 = 1750)" },
  // 12368: Sheet = [180, 129]
  { prefix: "30N", tail: "12368", expected: 180, expectedText: "180 tr", desc: "Hà Nội 30N-123.68 (Cột 2 = 180)" },
  { prefix: "51L", tail: "12368", expected: 129, expectedText: "129 tr", desc: "TPHCM 51L-123.68 (Cột 3 = 129)" },
  { prefix: "99A", tail: "12368", expected: 129, expectedText: "129 tr", desc: "Bắc Ninh 99A-123.68 (Cột 3 = 129)" },
  // 11689: Sheet = [120, 89] (overrides old KBVN 159tr!)
  { prefix: "11A", tail: "11689", expected: 89, expectedText: "89 tr", desc: "Cao Bằng 11A-116.89 (Cột 3 = 89, ghi đè KBVN cũ)" },
  // 28955: Sheet = [79, 79] (floor)
  { prefix: "51K", tail: "28955", expected: 79, expectedText: "79 tr", desc: "TPHCM 51K-289.55 (Cột 3 = 79 giá sàn)" },
  { prefix: "11A", tail: "28955", expected: 79, expectedText: "79 tr", desc: "Tỉnh 11A-289.55 (Cột 3 = 79 giá sàn)" },
];

for (const c of sheetCarCases) {
  const res = testPlate(c.prefix, c.tail, 0);
  check(res.raw === c.expected && res.text === c.expectedText, `${c.desc} -> got ${res.raw} (${res.text})`);
}

// Verify 8xxxx safety guard if 8xxxx is currently unfilled in Sheet
if (giaData.sheet_skip_heads && giaData.sheet_skip_heads.includes("8")) {
  const vip8 = testPlate("30D", "88888", 0);
  check(vip8.raw === -1 && vip8.text === "Liên hệ", `30D-888.88 safety guard when 8xxxx unfilled -> ${vip8.raw} (${vip8.text})`);
}

// 3. Test sample motorcycle plates (unaffected by car Google Sheet)
console.log("\nTesting sample MOTORCYCLE plates from gia.json:");
const sampleMotoPlates = ["50AG66668", "50AG66868", "50AG97979"];
for (const p of sampleMotoPlates) {
  const m = p.match(/^(\d{2}[A-Z]{2})(\d{5})$/);
  if (m) {
    const kPrice = giaData.k[p];
    const expectedMarkup = KE.kbMarkup(kPrice);
    const res = testPlate(m[1], m[2], 1);
    check(res.raw === expectedMarkup, `Moto ${p}: engine=${res.raw} (${res.text}) == kbMarkup=${expectedMarkup}`);
  }
}
const floorMoto = testPlate("59AA", "28955", 1);
check(floorMoto.raw === 15 || floorMoto.raw === 19, `Moto floor 59AA-289.55 -> ${floorMoto.raw} (${floorMoto.text}), not car 79tr`);

// 4. Test expiration logic in fromLive
console.log("\nTesting expiration logic in fromLive:");
const timeBefore1630 = Date.UTC(2026, 10, 16, 4, 0, 0);
const timeAfter1630 = Date.UTC(2026, 10, 16, 10, 0, 0);
const mockLive = {
  updated: "16/11/2026",
  rows: [
    ["30N11111", 0, 0, "18/11/2026", 0],
    ["30N22222", 0, 0, "17/11/2026", 0],
    ["30N33333", 0, 0, "16/11/2026", 0],
    ["30N44444", 0, 0, "", 0],
  ]
};
KE.setNow(timeBefore1630);
const sBefore = KE.fromLive(mockLive);
check(sBefore.len === 2, `Before 16h30 on 16/11 -> kept ${sBefore.len} plates (expected 2)`);

KE.setNow(timeAfter1630);
const sAfter = KE.fromLive(mockLive);
check(sAfter.len === 1, `After 16h30 on 16/11 -> kept ${sAfter.len} plates (expected 1)`);
KE.setNow(null);

// 5. Verify live.json runtime filtering removes any expired plates
const liveClean = JSON.parse(fs.readFileSync(path.join(__dirname, '../vpa-data/live.json'), 'utf8'));
const liveLoaded = KE.fromLive(liveClean);
console.log(`\nlive.json raw rows: ${liveClean.rows.length}, active after fromLive filter: ${liveLoaded.len}`);
check(liveLoaded.len <= liveClean.rows.length, "fromLive filters expired plates cleanly");

if (failed === 0) {
  console.log("\n=================================");
  console.log("ALL TESTS VERIFIED SUCCESSFULLY!");
  console.log("=================================");
  process.exit(0);
} else {
  console.error(`\n${failed} TESTS FAILED!`);
  process.exit(1);
}
