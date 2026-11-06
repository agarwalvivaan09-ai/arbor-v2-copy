import { CREATOR, HFRI_SITE, ARBOR, LOGO_SVG } from "./modules/site.js";
import { computeHFRI } from "./modules/hfri.js";

// ---------- links, credits, logo ----------
const LINKS = {
    ...CREATOR,
    calculator: HFRI_SITE.calculator,
    research: HFRI_SITE.research,
    paper: HFRI_SITE.paper,
    hfriSource: HFRI_SITE.source
};

document.querySelectorAll("[data-link]").forEach(a => {
    const url = LINKS[a.dataset.link];
    if (url) a.href = url;
});
document.querySelectorAll("[data-logo]").forEach(el => { el.innerHTML = LOGO_SVG; });
document.querySelector("[data-creator-role]").textContent = CREATOR.role;
document.querySelector("[data-creator-bio]").textContent = CREATOR.bio;
document.querySelector("[data-year]").textContent = new Date().getFullYear();

// ---------- mobile menu ----------
const toggle = document.querySelector("[data-nav-toggle]");
const menu = document.querySelector("[data-mobile-menu]");
toggle.addEventListener("click", () => {
    const open = menu.hidden;
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
});
menu.addEventListener("click", e => {
    if (e.target.closest("a")) {
        menu.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
    }
});

// ---------- nav shadow on scroll ----------
const nav = document.querySelector(".site-nav");
const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 8);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

// ---------- HFRI mini calculator ----------
const fields = [...document.querySelectorAll("[data-calc]")];
const ring = document.querySelector("[data-calc-ring]");
const scoreEl = document.querySelector("[data-calc-score]");
const bandEl = document.querySelector("[data-calc-band]");
const textEl = document.querySelector("[data-calc-text]");
const dimsEl = document.querySelector("[data-calc-dims]");

function readCalc() {
    const v = Object.fromEntries(fields.map(f => [f.dataset.calc, Math.max(0, Number(f.value) || 0)]));
    return v;
}

function renderCalc() {
    const v = readCalc();
    if (v.income <= 0) {
        scoreEl.textContent = "–";
        bandEl.textContent = "Enter your income";
        textEl.textContent = "";
        dimsEl.innerHTML = "";
        ring.style.setProperty("--v", 0);
        return;
    }

    const r = computeHFRI({
        income: v.income * 12,
        spending: v.spending * 12,
        debt: v.debt,
        debtService: v.debtService * 12,
        liquid: v.liquid,
        essentialMonthly: Math.min(v.essential || v.spending, v.spending || v.essential),
        cv: v.cv
    });

    scoreEl.textContent = r.total.toFixed(1);
    ring.style.setProperty("--v", r.total.toFixed(1));
    ring.dataset.band = r.band.key;
    bandEl.textContent = `${r.band.label} resilience`;
    textEl.textContent = r.band.text;

    const dims = [
        ["Savings Strength", r.scores.S],
        ["Debt Sustainability", r.scores.D],
        ["Emergency Coverage", r.scores.E],
        ["Expense Stability", r.scores.X]
    ];
    dimsEl.innerHTML = dims.map(([label, s]) => `
        <div><span>${label}</span><b>${s.toFixed(0)}</b><i style="--w:${Math.max(0, Math.min(100, s)).toFixed(0)}%"></i></div>
    `).join("");
}

fields.forEach(f => f.addEventListener("input", renderCalc));
renderCalc();

// ---------- signed-in users go straight to their dashboard ----------
// Loaded lazily so the landing page renders even if Firebase is slow.
import("./firebase/auth.js")
    .then(({ observeAuth }) => observeAuth(user => {
        if (!user) return;
        document.querySelectorAll("[data-auth-login]").forEach(a => {
            a.textContent = "Dashboard";
            a.href = "app.html";
        });
        document.querySelectorAll("[data-auth-cta]").forEach(a => {
            a.textContent = "Open your dashboard";
            a.href = "app.html";
        });
    }))
    .catch(() => { /* offline: keep the default links */ });
