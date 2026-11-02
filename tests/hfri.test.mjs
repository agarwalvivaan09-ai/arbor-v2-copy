import fs from "node:fs"; import assert from "node:assert/strict";
import { computeHFRI } from "../modules/hfri.js";
import { computeFinancials } from "../modules/engine.js";
// Cross-check against the official HFRI calculator when its repo is checked out next to this one.
const refPath = new URL("../../agarwalvivaan09-ai/HFRI/script.js", import.meta.url);
if (fs.existsSync(refPath)) {
    const src = fs.readFileSync(refPath,"utf8");
    const block = src.slice(src.indexOf("const HFRI = (() =>"), src.indexOf("})();", src.indexOf("const HFRI = (() =>"))+5);
    const REF = new Function(block + "; return HFRI;")();
    // random cross-check vs official calculator (monthly inputs)
    for (let i=0;i<2000;i++){
      const inc=5000+Math.random()*200000, sp=inc*(0.4+Math.random()), ess=sp*Math.random(), debt=Math.random()*inc*80, ds=Math.random()*inc*0.5, liq=Math.random()*inc*15, cv=Math.random()*1.2;
      const r=REF.compute({income:inc,spending:sp,debt,debtService:ds,liquid:liq,essential:ess||1,cv});
      const a=computeHFRI({income:inc*12,spending:sp*12,debt,debtService:ds*12,liquid:liq,essentialMonthly:ess||1,cv});
      assert.ok(Math.abs(r.total-a.total)<1e-9); assert.equal(REF.bandFor(r.total).key,a.band.key);
    }
    console.log("matches official calculator on 2000 random households");

} else console.log("(official calculator not found, skipping cross-check)");

// engine mapping
const today="2026-11-02T12:00:00Z";
const tx=[]; const add=(type,amount,date,subtype,extra={})=>tx.push({type,amount,date,subtype,accountId:"A",...extra});
for (const [m,spend] of [["2026-08",30000],["2026-09",40000],["2026-10",50000]]) {
  add("income",100000,m+"-01","salary");
  add("expense",10000,m+"-02","tax");
  add("expense",spend*0.8,m+"-05","fixed");
  add("expense",spend*0.2,m+"-06","discretionary");
}
const m=computeFinancials({accounts:[{id:"A",openingBalance:0}],transactions:tx,
  liabilities:[{id:"L",name:"Car",value:240000,rate:0,startDate:"2026-08-01"}],
  emis:[{id:"E",name:"Car",amount:10000,tenure:24,firstDate:"2026-09-01",accountId:"A",liabilityId:"L"}]},{today});
const h=m.hfri; assert.ok(h.available);
assert.equal(h.months,3);
assert.equal(h.inputs.income, 90000*12);           // income − tax
assert.equal(h.inputs.spending, 40000*12);         // excl tax & EMI
assert.equal(h.inputs.debtService, (20000/3)*12); // Sep+Oct EMIs; Nov EMI outside window
console.log(h.inputs, h.total.toFixed(2), h.band.label);
