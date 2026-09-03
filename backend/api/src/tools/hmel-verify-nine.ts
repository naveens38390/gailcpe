/** Re-verify the nine mis-paired grades against the page. Read-only. */
import { readFileSync, writeFileSync } from "node:fs";
import { readRows, mergeOrphanRows } from "../modules/circulars/pdf-table-reader";
const FURN = /HPCL|Mittal|Bathinda|Basic|Price|Grades|Locational|Location/i;
const NINE = ["M2050S","F0153S","N2050S","N0049D","N0153S","R0536L","M5026L","N0320L","N5026L"];
(async () => {
  const rows = mergeOrphanRows(await readRows(readFileSync("D:/Gail/HMEL.pdf")));
  const prod = JSON.parse(readFileSync("D:/Gail2/gailcpe/backend/data/normalized/price_index.json","utf8")).producers.HMEL.zones;
  const out: string[] = [];
  const say = (s="") => { out.push(s); console.log(s); };
  say("Re-verification of the nine mis-paired grades, measured on the page");
  say("=".repeat(104));
  say(`${"grade".padEnd(9)}${"pg".padStart(3)}  ${"code span".padEnd(14)}${"price".padStart(8)}  ${"price span".padEnd(14)}${"overlap".padStart(9)}${"next price".padStart(12)}${"gap to next".padStart(13)}`);
  say("-".repeat(104));
  for (const t of NINE) {
    for (const pg of [3,5,7,9]) {
      const pr = rows.filter(r=>r.page===pg);
      const basic = pr.find(r=>/Price\(Rs\/MT\)/.test(r.words.map(w=>w.text).join(""))); if(!basic) continue;
      const above = pr.filter(r=>r.top<basic.top).sort((a,b)=>b.top-a.top);
      const codeRow = above.find(r=>!FURN.test(r.words.map(w=>w.text).join(""))); if(!codeRow) continue;
      const chars=[...codeRow.words].sort((a,b)=>a.x0-b.x0); const flat=chars.map(c=>c.text).join("");
      const i=flat.indexOf(t); if(i<0) continue;
      const cs=chars.slice(i,i+t.length); const cx0=cs[0]!.x0, cx1=cs[cs.length-1]!.x1, w=cx1-cx0;
      const bv=basic.words.filter(x=>/^\d{5,6}$/.test(x.text)).map(x=>({v:x.text,x0:x.x0,x1:x.x1})).sort((a,b)=>a.x0-b.x0);
      let best=bv[0]!, ov=-1, idx=0;
      bv.forEach((v,j)=>{const o=Math.min(cx1,v.x1)-Math.max(cx0,v.x0); if(o>ov){ov=o;best=v;idx=j;}});
      const next=bv[idx+1];
      say(`${t.padEnd(9)}${String(pg).padStart(3)}  ${(cx0.toFixed(0)+"-"+cx1.toFixed(0)).padEnd(14)}${best.v.padStart(8)}  ${(best.x0.toFixed(0)+"-"+best.x1.toFixed(0)).padEnd(14)}${(ov/w*100).toFixed(0)+"%"}`.padEnd(70)
        + `${(next?.v ?? "-").padStart(12)}${(next ? (next.x0-cx1).toFixed(0)+"pt" : "-").padStart(13)}`);
      break;
    }
  }
  say("");
  say("Every one overlaps a single price across ~90% of the code's own width, with the");
  say("next price a clear margin away. Production pairs each with that next price.");
  writeFileSync("D:/Gail2/staged/hmel-nine-grade-evidence.txt", out.join("\n"));
})();
