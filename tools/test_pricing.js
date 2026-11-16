const fs = require('fs');
const path = require('path');

const window = {};
global.window = window;

require(path.join(__dirname, '../assets/kho-engine.js'));
const KE = window.KE;

console.log("KE loaded:", !!KE);
console.log("KE.kbMarkup function exists:", typeof KE.kbMarkup === 'function');
console.log("KE.setNow function exists:", typeof KE.setNow === 'function');

let failed = 0;

// 1. Formula unit tests for kbMarkup
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
  const ok = actual === c.expected;
  if (!ok) {
    console.error(`FAIL: ${c.desc} -> got ${actual}, expected ${c.expected}`);
    failed++;
  } else {
    console.log(`PASS: ${c.desc} -> ${actual}`);
  }
}

// 2. Test with real gia.json
const giaData = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/gia.json'), 'utf8'));
KE.setGia(giaData);
console.log("\nLoaded gia.json, total k plates:", Object.keys(giaData.k || {}).length);

function testPlate(prefix, numStr, moto = 0) {
  const s = {
    num: [parseInt(numStr, 10)],
    pre: [prefix],
    pi: [0],
    moto: [moto],
    tag: [0],
    text: () => `${prefix}-${numStr.slice(0,3)}.${numStr.slice(3)}`,
    prov: () => KE.provOf(prefix.slice(0, 2))
  };
  const raw = KE.giaOf(s, 0);
  const text = KE.giaText(raw);
  return { raw, text };
}

// Test sample car plates
console.log("\nTesting sample CAR plates from gia.json:");
const sampleCarPlates = [
  "11A11689", // k=118 -> kbMarkup=159
  "12A39393", // k=126 -> kbMarkup=169
  "12A45679", // k=104 -> kbMarkup=139
  "11A28955", // k=103 -> kbMarkup=139
];
for (const p of sampleCarPlates) {
  const m = p.match(/^(\d{2}[A-Z][A-Z0-9]?)(\d{5})$/);
  if (m) {
    const kPrice = giaData.k[p];
    const pPrice = giaData.p[p];
    const expectedMarkup = KE.kbMarkup(kPrice);
    const res = testPlate(m[1], m[2], 0);
    console.log(`Car ${p}: KBVN raw k=${kPrice}tr, gia.json p=${pPrice}tr, expected kbMarkup=${expectedMarkup}tr, engine giaOf=${res.raw} (${res.text})`);
    if (res.raw !== expectedMarkup) {
      console.error(`FAIL: Car ${p} engine price ${res.raw} != expected kbMarkup ${expectedMarkup}`);
      failed++;
    } else {
      console.log(`PASS: Car ${p} engine price correctly reflects kbMarkup`);
    }
  }
}

// Test sample motorcycle plates
console.log("\nTesting sample MOTORCYCLE plates from gia.json:");
const sampleMotoPlates = [
  "50AG66668", // k=160 -> kbMarkup=209
  "50AG66868", // k=160 -> kbMarkup=209
  "50AG97979", // k=160 -> kbMarkup=209
];
for (const p of sampleMotoPlates) {
  const m = p.match(/^(\d{2}[A-Z]{2})(\d{5})$/);
  if (m) {
    const kPrice = giaData.k[p];
    const pPrice = giaData.p[p];
    const expectedMarkup = KE.kbMarkup(kPrice);
    const res = testPlate(m[1], m[2], 1);
    console.log(`Moto ${p}: KBVN raw k=${kPrice}tr, gia.json p=${pPrice}tr, expected kbMarkup=${expectedMarkup}tr, engine giaOf=${res.raw} (${res.text})`);
    if (res.raw !== expectedMarkup) {
      console.error(`FAIL: Moto ${p} engine price ${res.raw} != expected kbMarkup ${expectedMarkup}`);
      failed++;
    } else {
      console.log(`PASS: Moto ${p} engine price correctly reflects kbMarkup`);
    }
  }
}

// 3. Test expiration logic in fromLive
console.log("\nTesting expiration logic in fromLive:");
// 16/11/2026 11:00 VN = 04:00 UTC (before 16:30 deadline of 18/11 auction)
const timeBefore1630 = Date.UTC(2026, 10, 16, 4, 0, 0);
// 16/11/2026 17:00 VN = 10:00 UTC (after 16:30 deadline of 18/11 auction)
const timeAfter1630 = Date.UTC(2026, 10, 16, 10, 0, 0);

const mockLive = {
  updated: "16/11/2026",
  rows: [
    ["30N11111", 0, 0, "18/11/2026", 0], // Dau 18/11: han 16h30 ngay 16/11
    ["30N22222", 0, 0, "17/11/2026", 0], // Dau 17/11: han 16h30 ngay 15/11 (da qua)
    ["30N33333", 0, 0, "16/11/2026", 0], // Dau 16/11: han 16h30 ngay 14/11 (da qua)
    ["30N44444", 0, 0, "", 0],           // Khong co ngay: giu nguyen
  ]
};

// Test before 16h30
KE.setNow(timeBefore1630);
const sBefore = KE.fromLive(mockLive);
console.log(`Before 16h30 (len=${sBefore.len}): plates=[${Array.from({length: sBefore.len}, (_, i) => sBefore.text(i)).join(", ")}]`);
if (sBefore.len !== 2) {
  console.error(`FAIL: Expected 2 plates before 16h30 (30N11111 and 30N44444), got ${sBefore.len}`);
  failed++;
} else {
  console.log("PASS: Before 16h30 on 16/11, 18/11 plate is kept, 17/11 and 16/11 plates are excluded.");
}

// Test after 16h30
KE.setNow(timeAfter1630);
const sAfter = KE.fromLive(mockLive);
console.log(`After 16h30 (len=${sAfter.len}): plates=[${Array.from({length: sAfter.len}, (_, i) => sAfter.text(i)).join(", ")}]`);
if (sAfter.len !== 1) {
  console.error(`FAIL: Expected 1 plate after 16h30 (only 30N44444), got ${sAfter.len}`);
  failed++;
} else {
  console.log("PASS: After 16h30 on 16/11, 18/11 plate is also excluded.");
}

// Reset setNow
KE.setNow(null);

// 4. Verify live.json clean state
console.log("\nVerifying vpa-data/live.json clean state:");
const liveClean = JSON.parse(fs.readFileSync(path.join(__dirname, '../vpa-data/live.json'), 'utf8'));
let expiredCount = 0;
const nowMs = Date.now();
for (const r of liveClean.rows) {
  const dateStr = String(r[3] || '');
  const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const day = +m[1], mo = +m[2], yr = +m[3];
    const key = yr + m[2] + m[1];
    const deadline = (liveClean.reg_end && liveClean.reg_end[key]) || Date.UTC(yr, mo - 1, day - 2, 9, 30, 0, 0);
    if (nowMs > deadline) expiredCount++;
  }
}
console.log(`live.json count: ${liveClean.count}, expired remaining: ${expiredCount}`);
if (expiredCount > 0) {
  console.error(`FAIL: Found ${expiredCount} expired plates remaining in live.json!`);
  failed++;
} else {
  console.log("PASS: 0 expired plates in live.json.");
}

if (failed === 0) {
  console.log("\n=================================");
  console.log("ALL TESTS VERIFIED SUCCESSFULLY!");
  console.log("=================================");
  process.exit(0);
} else {
  console.error(`\n${failed} TESTS FAILED!`);
  process.exit(1);
}
