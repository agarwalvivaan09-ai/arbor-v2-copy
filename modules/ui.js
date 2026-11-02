// Shared UI helpers: formatting, shell layout, charts.
import { CREATOR, HFRI_SITE, ARBOR, LOGO_SVG } from "./site.js";

export function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

export function formatMoney(value, { decimals = 0 } = {}) {
    const n = Number(value) || 0;
    const factor = 10 ** decimals;
    const rounded = Math.round(n * factor) / factor;
    const sign = rounded < 0 ? "-" : "";
    return `${sign}₹${Math.abs(rounded).toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

// Compact: ₹12.4L, ₹1.2Cr
export function formatShort(value) {
    const n = Number(value) || 0, a = Math.abs(n), sign = n < 0 ? "-" : "";
    if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(a >= 1e8 ? 1 : 2)}Cr`;
    if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(a >= 1e6 ? 1 : 2)}L`;
    if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(1)}K`;
    return `${sign}₹${Math.round(a)}`;
}

export const pct = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(d)}%`);

export function toDateValue(value) {
    if (!value) return null;
    if (typeof value === "object" && typeof value.seconds === "number") return new Date(value.seconds * 1000);
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

export function shortDate(value) {
    const d = toDateValue(value);
    return d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

export function localISODate(date = new Date()) {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function monthLabel(key) {
    const [y, m] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });
}

export function emptyState(title, text, action = "") {
    return `<div class="empty"><strong>${title}</strong><p>${text}</p>${action}</div>`;
}

export const kpi = (label, value, hint, cls = "") => `
    <div class="kpi ${cls}">
        <div class="kpi-label">${label}</div>
        <div class="kpi-value">${value}</div>
        <div class="kpi-hint">${hint}</div>
    </div>`;

export const icon = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

export const ICONS = {
    overview: "M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z",
    activity: "M4 6h16M4 12h16M4 18h10",
    accounts: "M3 10h18M5 10V20m4-10v10m6-10v10m4-10v10M2 20h20M12 3l9 5H3z",
    resilience: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z",
    stress: "M13 2 4 14h7l-1 8 9-12h-7z",
    forecast: "M3 20h18M5 16l4-5 4 3 6-8",
    guide: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zm0 0v16",
    journal: "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm2 5h6m-6 4h6m-6 4h4",
    ledger: "M4 4h16v16H4zM4 9h16M10 9v11",
    trial: "M12 3v18M5 7h14M7 7l-3 7h6zm10 0-3 7h6z",
    statements: "M6 2h9l5 5v15H6zM14 2v6h6M9 13h6m-6 4h6"
};

// The app shell shared by personal and business dashboards.
export function renderShell({ user, profile, nav, activeView, title, subtitle, content, topExtra = "", addLabel = "+ Add entry", addPanel = "activity", drawer = "" }) {
    return `
<div class="shell">
    <aside class="sidebar">
        <a class="sb-brand" href="index.html" title="Arbor home">${LOGO_SVG}<span><strong>Arbor</strong><small>by Vivaan Agarwal</small></span></a>

        <div class="sb-profile">
            <span class="sb-avatar">${escapeHTML((profile.name || "W")[0].toUpperCase())}</span>
            <div><strong>${escapeHTML(profile.name)}</strong><small>${escapeHTML(profile.type || "personal")} workspace</small></div>
            <button id="backBtn" class="sb-switch" title="Switch workspace">Switch</button>
        </div>

        <nav class="sb-nav" aria-label="Dashboard">
            ${nav.map(item => item.section
                ? `<div class="sb-section">${item.section}</div>`
                : `<button class="view-tab ${activeView === item.key ? "active" : ""}" data-view="${item.key}">${icon(ICONS[item.icon || item.key])}<span>${item.label}</span></button>`).join("")}
        </nav>

        <div class="sb-foot">
            <a href="${HFRI_SITE.calculator}" target="_blank" rel="noopener">HFRI Calculator ↗</a>
            <a href="index.html">Arbor home</a>
            <div class="credit">
                <small>Designed &amp; built by</small>
                <a href="${CREATOR.website}" target="_blank" rel="noopener">Vivaan Agarwal ↗</a>
            </div>
        </div>
    </aside>

    <div class="main">
        <header class="topbar">
            <div class="page-title">
                <h1>${title}</h1>
                <p>${subtitle}</p>
            </div>
            <div class="top-actions">
                ${topExtra}
                ${addLabel ? `<button id="togglePanel" class="btn btn-primary" data-open-panel="${addPanel}">${addLabel}</button>` : ""}
                <div class="user-chip" title="${escapeHTML(user.email || user.phoneNumber || "")}"><span>${escapeHTML((user.displayName || user.email || user.phoneNumber || "?")[0].toUpperCase())}</span><em>${escapeHTML(user.displayName || user.email || user.phoneNumber || "")}</em></div>
                <button id="logout" class="btn btn-ghost">Log out</button>
            </div>
        </header>

        <main class="content view-${activeView}">
            ${content}
        </main>

        <footer class="app-footer">
            <span>Arbor ${ARBOR.version} · Designed and built by <a href="${CREATOR.website}" target="_blank" rel="noopener">Vivaan Agarwal</a></span>
            <span><a href="${HFRI_SITE.research}" target="_blank" rel="noopener">HFRI research</a> · <a href="${CREATOR.linkedin}" target="_blank" rel="noopener">LinkedIn</a> · <a href="${CREATOR.github}" target="_blank" rel="noopener">GitHub</a></span>
        </footer>
    </div>
</div>
<div class="overlay" id="overlay"></div>
${drawer}`;
}

// ---------- charts (inline SVG) ----------
export function barChart(series, { a = "income", b = "spending", labelA = "Income", labelB = "Spending" } = {}) {
    const max = Math.max(1, ...series.flatMap(s => [s[a], s[b]]));
    const W = 560, H = 200, padB = 26, padT = 10, colW = W / series.length, barW = Math.min(22, colW / 3.2);
    const y = v => padT + (H - padB - padT) * (1 - Math.max(0, v) / max);
    const grid = [0.25, 0.5, 0.75, 1].map(f => `<line x1="0" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}" class="grid"/>`).join("");
    const bars = series.map((s, i) => {
        const cx = colW * i + colW / 2;
        return `
        <rect x="${cx - barW - 2}" y="${y(s[a])}" width="${barW}" height="${H - padB - y(s[a])}" rx="3" class="bar-in"><title>${monthLabel(s.month)} ${labelA.toLowerCase()} ${formatMoney(s[a])}</title></rect>
        <rect x="${cx + 2}" y="${y(s[b])}" width="${barW}" height="${H - padB - y(s[b])}" rx="3" class="bar-out"><title>${monthLabel(s.month)} ${labelB.toLowerCase()} ${formatMoney(s[b])}</title></rect>
        <text x="${cx}" y="${H - 6}" text-anchor="middle" class="axis">${monthLabel(s.month)}</text>`;
    }).join("");
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${labelA} and ${labelB} by month">${grid}${bars}</svg>`;
}

// Fan chart of percentile bands: [{ x, p5, p25, p50, p75, p95 }]
export function fanChart(bands, { xLabel = i => String(i), zeroLine = true } = {}) {
    if (!bands.length) return "";
    const W = 640, H = 260, padL = 64, padR = 12, padT = 12, padB = 28;
    const lo = Math.min(0, ...bands.map(b => b.p5)), hi = Math.max(1, ...bands.map(b => b.p95));
    const x = i => padL + (W - padL - padR) * (bands.length === 1 ? 0.5 : i / (bands.length - 1));
    const y = v => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo || 1));
    const area = (top, bot) => `M${bands.map((b, i) => `${x(i)},${y(b[top])}`).join("L")}L${bands.map((b, i) => `${x(bands.length - 1 - i)},${y(bands[bands.length - 1 - i][bot])}`).join("L")}Z`;
    const line = key => `M${bands.map((b, i) => `${x(i)},${y(b[key])}`).join("L")}`;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => lo + (hi - lo) * f);
    const step = Math.max(1, Math.ceil(bands.length / 8));
    return `<svg class="chart fan" viewBox="0 0 ${W} ${H}" role="img" aria-label="Projection range">
        ${ticks.map(t => `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${padL - 8}" y="${y(t) + 4}" text-anchor="end" class="axis">${formatShort(t)}</text>`).join("")}
        ${zeroLine && lo < 0 ? `<line x1="${padL}" x2="${W - padR}" y1="${y(0)}" y2="${y(0)}" class="zero"/>` : ""}
        <path d="${area("p95", "p5")}" class="band-outer"/>
        <path d="${area("p75", "p25")}" class="band-inner"/>
        <path d="${line("p50")}" class="median"/>
        ${bands.map((b, i) => (i % step === 0 || i === bands.length - 1) ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="axis">${xLabel(i)}</text>` : "").join("")}
    </svg>
    <div class="legend fan-legend"><span><i class="lg-median"></i>Median</span><span><i class="lg-inner"></i>Middle 50%</span><span><i class="lg-outer"></i>90% of outcomes</span></div>`;
}

// Cash path for stress tests
export function pathChart(path, { label = "Cash" } = {}) {
    const W = 560, H = 180, padL = 60, padR = 10, padT = 10, padB = 24;
    const lo = Math.min(0, ...path), hi = Math.max(1, ...path);
    const x = i => padL + (W - padL - padR) * (path.length === 1 ? 0 : i / (path.length - 1));
    const y = v => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo || 1));
    const ticks = [lo, (lo + hi) / 2, hi];
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label} month by month">
        ${ticks.map(t => `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${padL - 8}" y="${y(t) + 4}" text-anchor="end" class="axis">${formatShort(t)}</text>`).join("")}
        ${lo < 0 ? `<line x1="${padL}" x2="${W - padR}" y1="${y(0)}" y2="${y(0)}" class="zero"/>` : ""}
        <path d="M${path.map((v, i) => `${x(i)},${y(v)}`).join("L")}" class="median"/>
        ${path.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3" class="${v < 0 ? "pt-neg" : "pt"}"><title>Month ${i}: ${formatMoney(v)}</title></circle>`).join("")}
        ${path.map((v, i) => (path.length <= 13 || i % Math.ceil(path.length / 12) === 0) ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="axis">${i === 0 ? "Now" : `M${i}`}</text>` : "").join("")}
    </svg>`;
}

// Number input that reads cleanly
export const numField = (id, label, value, { step = "any", suffix = "", help = "" } = {}) => `
    <label class="field"><span>${label}${suffix ? ` <span class="unit">(${suffix})</span>` : ""}</span>
        <input id="${id}" type="number" step="${step}" value="${value}" inputmode="decimal" />
        ${help ? `<small class="field-note">${help}</small>` : ""}
    </label>`;
