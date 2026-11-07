// ==========================================================
// ARBOR FAMILY
// A family brings several people's personal and business profiles together:
// combined cash, assets, liabilities, due payments and one family HFRI.
// Linked profiles are read-only here; each person keeps editing their own
// profile in its own workspace. Permissions live in firestore.rules.
// ==========================================================
import {
    getFamily, getFamilyProfiles, linkProfile, unlinkProfile, removeMember, leaveFamily,
    deleteFamily, renameFamily, getFamilyInvites, inviteMember, cancelInvite,
    getItems, addItem, deleteItem, subscribeMessages, sendMessage, deleteMessage, MAX_INVITED
} from "./modules/family.js";
import { summarizeFamily } from "./modules/family-summary.js";
import { computeFinancials } from "./modules/engine.js";
import { computeBooks, financialYear } from "./modules/accounting.js";
import { loadBooks } from "./modules/books.js";
import { getProfiles } from "./profiles/profiles.js";
import { getTransactions } from "./modules/transactions.js";
import { getAccounts } from "./modules/accounts.js";
import { getAssets, getLiabilities } from "./modules/networth.js";
import { getEMIs } from "./modules/emi.js";
import { familyGuide } from "./modules/guide.js";
import { HFRI_SITE } from "./modules/site.js";
import {
    renderShell, escapeHTML, formatMoney, formatShort, shortDate, localISODate, kpi, emptyState
} from "./modules/ui.js";

const NAV = [
    { key: "overview", label: "Overview" },
    { key: "profiles", label: "Profiles", icon: "accounts" },
    { key: "items", label: "Family assets", icon: "statements" },
    { key: "members", label: "Members", icon: "activity" },
    { key: "chat", label: "Chat", icon: "journal" },
    { section: "Help" },
    { key: "guide", label: "Guide" }
];
const VIEWS = NAV.filter(n => n.key).map(n => n.key);
const viewKey = fid => `arbor.famView.${fid}`;
const typeLabel = t => (t === "business" ? "Business" : t === "family" ? "Household" : "Personal");

let unsubscribeChat = null;

// ----------------------------------------------------------
async function loadFamilyData(family, user) {
    const today = new Date();
    const [linked, items, mine, invites] = await Promise.all([
        getFamilyProfiles(family.id),
        getItems(family.id),
        getProfiles(user.uid),
        family.ownerId === user.uid ? getFamilyInvites(family.id) : Promise.resolve([])
    ]);

    const fy = financialYear(today);
    const period = { from: fy.from, to: localISODate(today) };
    const personal = [], business = [], failed = [];

    await Promise.all(linked.map(async profile => {
        try {
            if (profile.type === "business") {
                const books = computeBooks(await loadBooks(profile.id), period);
                business.push({ profile, books });
            } else {
                const [assets, liabilities, transactions, accounts, emis] = await Promise.all([
                    getAssets(profile.id), getLiabilities(profile.id), getTransactions(profile.id),
                    getAccounts(profile.id), getEMIs(profile.id)
                ]);
                const metrics = computeFinancials({ assets, liabilities, transactions, accounts, emis }, { today });
                personal.push({ profile, metrics, emis });
            }
        } catch (error) {
            console.error("Could not load linked profile", profile.id, error);
            failed.push(profile);
        }
    }));

    const order = (a, b) => linked.indexOf(a.profile) - linked.indexOf(b.profile);
    personal.sort(order); business.sort(order);
    const summary = summarizeFamily({ personal, business, items, today });
    return { linked, items, mine, invites, summary, failed, period };
}

// ----------------------------------------------------------
export async function renderFamily({ user, familyId, onSwitch, onLogout }) {
    if (unsubscribeChat) { unsubscribeChat(); unsubscribeChat = null; }

    const family = await getFamily(familyId);
    if (!family || !(family.memberIds || []).includes(user.uid)) { await onSwitch(); return; }

    const isHead = family.ownerId === user.uid;
    const data = await loadFamilyData(family, user);
    const memberName = uid => family.members?.[uid]?.name || "Former member";

    let activeView = localStorage.getItem(viewKey(family.id)) || "overview";
    if (!VIEWS.includes(activeView)) activeView = "overview";

    const people = family.memberIds.length;
    const META = {
        overview: [escapeHTML(family.name), `Family overview · ${people} ${people === 1 ? "person" : "people"} · ${data.linked.length} linked profile${data.linked.length === 1 ? "" : "s"}`],
        profiles: ["Profiles", "Personal and business profiles counted in this family"],
        items: ["Family assets", "Things the family owns or owes together, and payments that are due"],
        members: ["Members", isHead ? "Invite up to 3 people and manage the family" : "Who is in this family"],
        chat: ["Family chat", "Messages are visible to everyone in the family"],
        guide: ["Family guide", "How families work in Arbor"]
    };

    const ctx = { user, family, isHead, data, memberName };
    const content = {
        overview: () => overviewView(ctx),
        profiles: () => profilesView(ctx),
        items: () => itemsView(ctx),
        members: () => membersView(ctx),
        chat: () => chatView(ctx),
        guide: () => familyGuide()
    }[activeView]();

    document.body.innerHTML = renderShell({
        user,
        profile: { name: family.name, type: "family" },
        nav: NAV, activeView,
        title: META[activeView][0], subtitle: META[activeView][1],
        content, addLabel: ""
    });
    document.body.classList.remove("is-business");

    const rerender = () => renderFamily({ user, familyId, onSwitch, onLogout });
    const flash = (id, text, type = "error") => { const el = document.getElementById(id); if (el) { el.textContent = text; el.className = `auth-message ${type}`; } };
    let busy = false;
    const guarded = async (msgId, fn, okText) => {
        if (busy) return;
        busy = true;
        try { await fn(); if (okText) flash(msgId, okText, "success"); await rerender(); }
        catch (error) { console.error(error); flash(msgId, friendlyError(error)); }
        finally { busy = false; }
    };

    if (activeView === "chat") bindChat(ctx);
    if (activeView === "items") bindItemForm(ctx, guarded);
    if (activeView === "members") bindMembers(ctx, guarded, onSwitch);

    document.body.onclick = async (e) => {
        const t = e.target instanceof Element ? e.target : null;
        if (!t) return;
        const go = t.closest("[data-view], [data-go-view]");
        if (go) {
            localStorage.setItem(viewKey(family.id), go.dataset.view || go.dataset.goView);
            await rerender(); window.scrollTo({ top: 0 }); return;
        }
        if (t.id === "backBtn") { if (unsubscribeChat) { unsubscribeChat(); unsubscribeChat = null; } await onSwitch(); return; }
        if (t.id === "logout") { if (unsubscribeChat) { unsubscribeChat(); unsubscribeChat = null; } await onLogout(); return; }
        const jump = t.closest("[data-guide-jump]");
        if (jump) { document.getElementById(jump.dataset.guideJump)?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }

        const link = t.closest("[data-link-profile]");
        if (link) return guarded("profilesMessage", () => linkProfile(link.dataset.linkProfile, family));
        const unlink = t.closest("[data-unlink-profile]");
        if (unlink) {
            const p = data.linked.find(x => x.id === unlink.dataset.unlinkProfile);
            const own = p?.userId === user.uid;
            if (!confirm(own ? `Remove “${p?.name}” from the family? It stays in your workspaces.` : `Remove ${memberName(p?.userId)}’s “${p?.name}” from the family? It stays in their workspaces.`)) return;
            return guarded("profilesMessage", () => unlinkProfile(unlink.dataset.unlinkProfile));
        }
        const delItem = t.closest("[data-delete-item]");
        if (delItem) {
            if (!confirm("Remove this from the family?")) return;
            return guarded("itemsMessage", () => deleteItem(family.id, delItem.dataset.deleteItem));
        }
        const delMsg = t.closest("[data-delete-message]");
        if (delMsg) { try { await deleteMessage(family.id, delMsg.dataset.deleteMessage); } catch (err) { console.error(err); } return; }
    };
}

function friendlyError(error) {
    const code = error?.code || "";
    if (code === "permission-denied") return "You don't have permission to do that.";
    if (code === "unavailable") return "You're offline. Check your connection and try again.";
    return "Something went wrong. Please try again.";
}

// ==========================================================
// OVERVIEW
// ==========================================================
function hfriCard(h, { title = "Family HFRI", note = "" } = {}) {
    if (!h?.available) {
        return `<section class="card fam-hfri"><div class="card-head"><h2>${title}</h2></div>
            ${emptyState("Not enough data yet", escapeHTML(h?.reason || "Link personal profiles with income and spending."),
                `<button class="btn btn-ghost btn-sm" data-go-view="profiles">Link profiles</button>`)}</section>`;
    }
    const s = h.scores, ind = h.indicators;
    const pct = v => `${(v * 100).toFixed(1)}%`;
    const ec = ind.ec === Infinity ? "∞" : `${ind.ec.toFixed(1)} months`;
    const dims = [
        ["Savings strength", s.S, `Savings rate ${pct(ind.sr)}`],
        ["Debt sustainability", s.D, `Debt ${pct(ind.dti)} of income · repayments ${pct(ind.dsti)}`],
        ["Emergency coverage", s.E, `${ec} of essential spending`],
        ["Expense stability", s.X, `Spending variation ${ind.cv.toFixed(2)}`]
    ];
    return `
<section class="card fam-hfri">
    <div class="fam-hfri-head">
        <div class="ring lg" data-band="${h.band.key}" style="--v:${h.total.toFixed(1)}"><strong>${h.total.toFixed(1)}</strong></div>
        <div>
            <div class="eyebrow-sm">${title}</div>
            <h2>${escapeHTML(h.band.label)} resilience</h2>
            <p class="muted">How well the household could absorb a shock, such as a job loss or a large bill, while still paying for essentials. ${note}</p>
        </div>
    </div>
    <div class="fam-dims">
        ${dims.map(([label, v, sub]) => `
        <div class="fam-dim">
            <div class="fam-dim-top"><span>${label}</span><strong>${v.toFixed(0)}</strong></div>
            <div class="bar"><i class="bar-fill" data-band="${h.band.key}" style="width:${Math.max(2, Math.min(100, v)).toFixed(0)}%"></i></div>
            <small>${sub}</small>
        </div>`).join("")}
    </div>
    <div class="fam-inputs">
        <span>Income after tax <b>${formatShort(h.inputs.income)}/yr</b></span>
        <span>Spending <b>${formatShort(h.inputs.spending)}/yr</b></span>
        <span>Debt <b>${formatShort(h.inputs.debt)}</b></span>
        <span>Liquid savings <b>${formatShort(h.inputs.liquid)}</b></span>
    </div>
    <div class="btn-row">
        <a class="btn btn-ghost btn-sm" href="${HFRI_SITE.calculator}" target="_blank" rel="noopener">HFRI calculator ↗</a>
        <button class="btn btn-ghost btn-sm" data-go-view="guide">How the family score works</button>
    </div>
</section>`;
}

function overviewView({ data, memberName }) {
    const { summary: s, linked } = data;
    const t = s.totals;
    if (!linked.length && !data.items.length) {
        return `<section class="card">${emptyState("Start by linking profiles",
            "Add your personal and business profiles to see the family's combined cash, assets, liabilities and HFRI. Each person links their own profiles.",
            `<div class="btn-row"><button class="btn btn-primary btn-sm" data-go-view="profiles">Link profiles</button><button class="btn btn-ghost btn-sm" data-go-view="items">Add a family asset</button><button class="btn btn-ghost btn-sm" data-go-view="members">Invite family</button></div>`)}</section>`;
    }
    const cashTotal = Math.max(1, s.cashBy.personal + s.cashBy.business + s.cashBy.family);
    const share = v => `${Math.max(0, (v / cashTotal) * 100).toFixed(1)}%`;
    const dues = s.dues.slice(0, 8);
    const failedNote = data.failed.length ? `<p class="fam-warn">Couldn't load ${data.failed.map(p => escapeHTML(p.name)).join(", ")}. Totals leave them out.</p>` : "";

    return `
${failedNote}
<div class="kpi-grid">
    ${kpi("Cash available", formatMoney(t.cash), "Accounts, business bank and liquid family savings")}
    ${kpi("Assets", formatMoney(t.assets), "Investments, property, business assets")}
    ${kpi("Liabilities", formatMoney(t.liabilities), "Loans and money owed")}
    ${kpi("Net worth", formatMoney(t.netWorth), "Everything owned minus everything owed", t.netWorth < 0 ? "neg" : "")}
</div>

<div class="fam-cols">
    ${hfriCard(s.hfri, { note: s.counts.business ? "Built from the personal profiles; business money isn't counted as household savings." : "" })}

    <section class="card">
        <div class="card-head"><h2>Payments due</h2><span class="muted small">Overdue and next 30 days</span></div>
        ${dues.length ? `<ul class="fam-list">${dues.map(d => `
            <li class="${d.overdue ? "overdue" : ""}">
                <div><strong>${escapeHTML(d.name)}</strong><small>${escapeHTML(d.source)} · ${escapeHTML(d.kind)}</small></div>
                <div class="right"><strong>${d.amount ? formatMoney(d.amount) : "—"}</strong><small>${d.overdue ? "Overdue · " : ""}${shortDate(d.date)}</small></div>
            </li>`).join("")}</ul>`
            : emptyState("Nothing due soon", "EMIs from linked profiles and family dues will appear here.")}
        ${t.payables || t.receivables ? `<div class="fam-inputs"><span>Businesses owe suppliers <b>${formatShort(t.payables)}</b></span><span>Customers owe businesses <b>${formatShort(t.receivables)}</b></span></div>` : ""}
    </section>
</div>

<section class="card">
    <div class="card-head"><h2>Where the cash is</h2><span class="muted small">${formatMoney(t.cash)}</span></div>
    <div class="fam-split" aria-hidden="true">
        <i class="p" style="width:${share(s.cashBy.personal)}"></i><i class="b" style="width:${share(s.cashBy.business)}"></i><i class="f" style="width:${share(s.cashBy.family)}"></i>
    </div>
    <div class="fam-legend">
        <span><i class="p"></i>Personal ${formatShort(s.cashBy.personal)}</span>
        <span><i class="b"></i>Business ${formatShort(s.cashBy.business)}</span>
        <span><i class="f"></i>Family savings ${formatShort(s.cashBy.family)}</span>
    </div>
</section>

<section class="card">
    <div class="card-head"><h2>Every profile</h2><button class="btn btn-ghost btn-sm" data-go-view="profiles">Manage</button></div>
    ${s.rows.length ? `<div class="table-wrap"><table class="fam-table">
        <thead><tr><th>Profile</th><th>Owner</th><th class="num">Cash</th><th class="num">Assets</th><th class="num">Liabilities</th><th class="num">Net worth</th><th class="num">HFRI</th></tr></thead>
        <tbody>${s.rows.map(r => `<tr>
            <td><strong>${escapeHTML(r.name)}</strong><small class="tag ${r.type}">${typeLabel(r.type)}</small></td>
            <td>${escapeHTML(memberName(r.ownerId))}</td>
            <td class="num">${formatShort(r.cash)}</td><td class="num">${formatShort(r.assets)}</td>
            <td class="num">${formatShort(r.liabilities)}</td><td class="num">${formatShort(r.netWorth)}</td>
            <td class="num">${r.hfri !== null ? `<span class="pill" data-band="${r.hfriBand.key}">${r.hfri.toFixed(1)}</span>` : `<span class="muted small" title="${escapeHTML(r.hfriReason)}">—</span>`}</td>
        </tr>`).join("")}
        ${t.familyAssets || t.familyLiabilities ? `<tr class="fam-row-family"><td><strong>Family-owned</strong><small class="tag family">Family</small></td><td>Shared</td><td class="num">—</td><td class="num">${formatShort(t.familyAssets)}</td><td class="num">${formatShort(t.familyLiabilities)}</td><td class="num">${formatShort(t.familyAssets - t.familyLiabilities)}</td><td class="num">—</td></tr>` : ""}
        </tbody></table></div>` : emptyState("No profiles linked yet", "Link personal or business profiles to include them.")}
</section>`;
}

// ==========================================================
// PROFILES
// ==========================================================
function profilesView({ user, family, isHead, data, memberName }) {
    const linkedRows = data.linked.map(p => {
        const canRemove = isHead || p.userId === user.uid;
        return `<li>
            <div><strong>${escapeHTML(p.name)}</strong><small>${typeLabel(p.type)} · ${p.userId === user.uid ? "You" : escapeHTML(memberName(p.userId))}</small></div>
            ${canRemove ? `<button class="btn btn-ghost btn-sm" data-unlink-profile="${p.id}">Remove</button>` : ""}
        </li>`;
    }).join("");

    const mine = data.mine;
    const mineRows = mine.map(p => {
        const here = p.familyId === family.id;
        const elsewhere = p.familyId && !here;
        return `<li>
            <div><strong>${escapeHTML(p.name)}</strong><small>${typeLabel(p.type)}${elsewhere ? ` · in “${escapeHTML(p.familyName || "another family")}”` : ""}</small></div>
            ${here ? `<span class="muted small">Linked</span>`
                : elsewhere ? `<span class="muted small">Remove it from that family first</span>`
                : `<button class="btn btn-primary btn-sm" data-link-profile="${p.id}">Add to family</button>`}
        </li>`;
    }).join("");

    return `
<div id="profilesMessage" class="auth-message" role="status"></div>
<div class="fam-cols">
    <section class="card">
        <div class="card-head"><h2>In this family</h2><span class="muted small">${data.linked.length}</span></div>
        ${data.linked.length ? `<ul class="fam-list">${linkedRows}</ul>` : emptyState("Nothing linked yet", "Add your profiles from the list on the right.")}
        <p class="muted small">${isHead ? "As the family head you can remove anyone's profile." : "You can remove your own profiles. Only the family head can remove other people's."}</p>
    </section>
    <section class="card">
        <div class="card-head"><h2>Your profiles</h2></div>
        ${mine.length ? `<ul class="fam-list">${mineRows}</ul>` : emptyState("You have no profiles yet", "Create a personal or business workspace first, then come back to add it.")}
        <p class="fam-note">Adding a profile lets everyone in this family <strong>see</strong> its numbers. Only you can change it, and each profile can be in one family at a time.</p>
    </section>
</div>`;
}

// ==========================================================
// FAMILY ITEMS
// ==========================================================
function itemsView({ user, isHead, data }) {
    const groups = [
        ["asset", "Owned together", "House, land, gold, a family car, a joint FD…"],
        ["liability", "Owed together", "A home loan, a loan from relatives…"],
        ["due", "Payments due", "School fees, insurance premiums, rent, property tax…"]
    ];
    const row = it => {
        const canDelete = isHead || it.addedBy === user.uid;
        const meta = it.kind === "due"
            ? `${it.dueDate ? `Due ${shortDate(it.dueDate)}` : "No date"}${it.repeat === "monthly" ? " · every month" : ""}`
            : it.kind === "asset" && it.liquid ? "Counts as cash" : "";
        return `<li>
            <div><strong>${escapeHTML(it.name)}</strong><small>${[meta, `Added by ${escapeHTML(it.addedByName || "a member")}`].filter(Boolean).join(" · ")}</small></div>
            <div class="right"><strong>${formatMoney(it.value)}</strong>${canDelete ? `<button class="link-btn" data-delete-item="${it.id}">Remove</button>` : ""}</div>
        </li>`;
    };
    return `
<div id="itemsMessage" class="auth-message" role="status"></div>
<div class="fam-cols">
    <div class="fam-stack">
        ${groups.map(([kind, title, hint]) => {
            const list = data.items.filter(i => i.kind === kind);
            return `<section class="card"><div class="card-head"><h2>${title}</h2><span class="muted small">${formatMoney(list.reduce((s, i) => s + (Number(i.value) || 0), 0))}</span></div>
                ${list.length ? `<ul class="fam-list">${list.map(row).join("")}</ul>` : `<p class="muted small">${hint}</p>`}</section>`;
        }).join("")}
    </div>
    <section class="card">
        <div class="card-head"><h2>Add to the family</h2></div>
        <form id="itemForm" class="form-grid" novalidate>
            <label class="field">What is it?
                <select id="itemKind">
                    <option value="asset">Something we own (asset)</option>
                    <option value="liability">Something we owe (liability)</option>
                    <option value="due">A payment that's due</option>
                </select>
            </label>
            <label class="field">Name<input id="itemName" maxlength="80" placeholder="e.g. Family home" /></label>
            <label class="field"><span id="itemValueLabel">Current value (₹)</span><input id="itemValue" type="number" min="0" step="any" inputmode="decimal" placeholder="0" /></label>
            <label class="check-row" id="liquidRow"><input type="checkbox" id="itemLiquid" /> Counts as cash (savings account, FD, cash at home)</label>
            <label class="field" id="dueRow" hidden>Due date<input id="itemDue" type="date" /></label>
            <label class="check-row" id="repeatRow" hidden><input type="checkbox" id="itemRepeat" /> Repeats every month</label>
            <button class="btn btn-primary btn-block" type="submit">Add</button>
        </form>
        <p class="fam-note">Family items are included in the family's totals. Loans count as debt and “counts as cash” savings as liquid savings in the family HFRI.</p>
    </section>
</div>`;
}

function bindItemForm({ user, family }, guarded) {
    const $ = id => document.getElementById(id);
    const sync = () => {
        const k = $("itemKind").value;
        $("liquidRow").hidden = k !== "asset";
        $("dueRow").hidden = k !== "due";
        $("repeatRow").hidden = k !== "due";
        $("itemValueLabel").textContent = k === "asset" ? "Current value (₹)" : k === "liability" ? "Amount still owed (₹)" : "Amount (₹)";
        $("itemName").placeholder = k === "asset" ? "e.g. Family home" : k === "liability" ? "e.g. Home loan" : "e.g. School fees";
    };
    $("itemKind").onchange = sync; sync();
    $("itemForm").onsubmit = e => {
        e.preventDefault();
        const kind = $("itemKind").value, name = $("itemName").value.trim(), value = Number($("itemValue").value);
        const msg = t => { $("itemsMessage").textContent = t; $("itemsMessage").className = "auth-message error"; };
        if (!name) return msg("Give it a name.");
        if (!Number.isFinite(value) || value < 0) return msg("Enter an amount of 0 or more.");
        if (kind === "due" && !$("itemDue").value) return msg("Pick the due date.");
        const item = { kind, name, value };
        if (kind === "asset") item.liquid = $("itemLiquid").checked;
        if (kind === "due") { item.dueDate = $("itemDue").value; item.repeat = $("itemRepeat").checked ? "monthly" : null; }
        guarded("itemsMessage", () => addItem(family.id, user, item));
    };
}

// ==========================================================
// MEMBERS
// ==========================================================
function membersView({ user, family, isHead, data, memberName }) {
    const pending = data.invites.filter(i => i.status === "pending");
    const invitedCount = family.memberIds.length - 1 + pending.length;
    const canInvite = isHead && invitedCount < MAX_INVITED;
    const members = family.memberIds.map(uid => {
        const m = family.members?.[uid] || {};
        const head = uid === family.ownerId;
        return `<li>
            <div><strong>${escapeHTML(m.name || memberName(uid))}${uid === user.uid ? " (you)" : ""}</strong><small>${escapeHTML(m.email || "")}${head ? " · Family head" : ""}</small></div>
            ${isHead && !head ? `<button class="btn btn-ghost btn-sm" data-remove-member="${uid}">Remove</button>` : head ? `<span class="tag head">Head</span>` : ""}
        </li>`;
    }).join("");
    const inviteRows = data.invites.filter(i => i.status !== "accepted").map(i => `<li>
        <div><strong>${escapeHTML(i.email)}</strong><small>${i.status === "declined" ? "Declined" : "Invited · waiting for them to accept"}</small></div>
        <button class="btn btn-ghost btn-sm" data-cancel-invite="${escapeHTML(i.email)}">${i.status === "declined" ? "Clear" : "Cancel"}</button>
    </li>`).join("");

    return `
<div id="membersMessage" class="auth-message" role="status"></div>
<div class="fam-cols">
    <section class="card">
        <div class="card-head"><h2>People</h2><span class="muted small">${family.memberIds.length} of ${MAX_INVITED + 1}</span></div>
        <ul class="fam-list">${members}</ul>
        ${isHead && inviteRows ? `<h3 class="fam-sub">Invites</h3><ul class="fam-list">${inviteRows}</ul>` : ""}
    </section>
    <div class="fam-stack">
        ${isHead ? `
        <section class="card">
            <div class="card-head"><h2>Invite someone</h2><span class="muted small">${Math.max(0, MAX_INVITED - invitedCount)} of ${MAX_INVITED} invites left</span></div>
            <form id="inviteForm" class="form-grid" novalidate>
                <label class="field">Their email<input id="inviteEmail" type="email" autocomplete="off" placeholder="name@example.com" ${canInvite ? "" : "disabled"} /></label>
                <button class="btn btn-primary btn-block" type="submit" ${canInvite ? "" : "disabled"}>Send invite</button>
            </form>
            <p class="fam-note">They'll see the invite when they sign in to Arbor with this email, and must accept it. Once in, they can add their own profiles to the family.</p>
        </section>
        <section class="card">
            <div class="card-head"><h2>Family settings</h2></div>
            <form id="renameForm" class="inline-form" novalidate>
                <input id="familyName" maxlength="60" value="${escapeHTML(family.name)}" aria-label="Family name" />
                <button class="btn btn-ghost btn-sm" type="submit">Rename</button>
            </form>
            <div class="danger">
                <strong>Delete family</strong>
                <p class="muted small">Unlinks every profile (they aren't deleted), removes family items, chat and invites.</p>
                <button class="btn btn-danger btn-sm" id="deleteFamily">Delete family</button>
            </div>
        </section>`
        : `
        <section class="card">
            <div class="card-head"><h2>Your membership</h2></div>
            <p class="muted">${escapeHTML(memberName(family.ownerId))} is the family head and manages members. You can add your own profiles, add family items and chat.</p>
            <div class="danger">
                <strong>Leave family</strong>
                <p class="muted small">Your profiles are removed from this family first. They stay in your workspaces.</p>
                <button class="btn btn-danger btn-sm" id="leaveFamily">Leave family</button>
            </div>
        </section>`}
    </div>
</div>`;
}

function bindMembers({ user, family, isHead, data, memberName }, guarded, onSwitch) {
    const $ = id => document.getElementById(id);
    const msg = (t, type = "error") => { $("membersMessage").textContent = t; $("membersMessage").className = `auth-message ${type}`; };
    document.querySelectorAll("[data-remove-member]").forEach(b => b.onclick = () => {
        const uid = b.dataset.removeMember;
        if (!confirm(`Remove ${memberName(uid)} from the family? Their profiles are unlinked first; nothing is deleted.`)) return;
        guarded("membersMessage", () => removeMember(family.id, uid));
    });
    document.querySelectorAll("[data-cancel-invite]").forEach(b => b.onclick = () =>
        guarded("membersMessage", () => cancelInvite(family.id, b.dataset.cancelInvite)));

    if (isHead) {
        $("inviteForm").onsubmit = e => {
            e.preventDefault();
            const email = $("inviteEmail").value.trim().toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return msg("Enter a valid email address.");
            if (email === (user.email || "").toLowerCase()) return msg("That's your own email.");
            if (Object.values(family.members || {}).some(m => (m.email || "").toLowerCase() === email)) return msg("They're already in the family.");
            if (data.invites.some(i => i.email === email && i.status === "pending")) return msg("They've already been invited.");
            guarded("membersMessage", () => inviteMember(family, email, user), `Invite sent to ${email}.`);
        };
        $("renameForm").onsubmit = e => {
            e.preventDefault();
            const name = $("familyName").value.trim();
            if (!name) return msg("Enter a name.");
            guarded("membersMessage", () => renameFamily(family.id, name));
        };
        $("deleteFamily").onclick = async () => {
            if (!confirm(`Delete “${family.name}”? Every profile is unlinked (not deleted). Family items, chat and invites are removed. This can't be undone.`)) return;
            try { await deleteFamily(family.id); localStorage.removeItem("selectedFamily"); await onSwitch(); }
            catch (error) { console.error(error); msg(friendlyError(error)); }
        };
    } else {
        $("leaveFamily").onclick = async () => {
            if (!confirm(`Leave “${family.name}”? Your profiles will be removed from it.`)) return;
            try { await leaveFamily(family.id, user.uid); localStorage.removeItem("selectedFamily"); await onSwitch(); }
            catch (error) { console.error(error); msg(friendlyError(error)); }
        };
    }
}

// ==========================================================
// CHAT
// ==========================================================
function chatView() {
    return `
<section class="card fam-chat">
    <div class="fam-chat-log" id="chatLog" aria-live="polite"><p class="muted small center">Loading messages…</p></div>
    <form id="chatForm" class="fam-chat-form" autocomplete="off">
        <input id="chatText" maxlength="1000" placeholder="Write a message…" aria-label="Message" />
        <button class="btn btn-primary" type="submit">Send</button>
    </form>
</section>`;
}

function bindChat({ user, family, isHead }) {
    const log = document.getElementById("chatLog");
    const form = document.getElementById("chatForm");
    const input = document.getElementById("chatText");
    const time = ts => {
        const d = ts?.toDate ? ts.toDate() : null;
        if (!d) return "sending…";
        const sameDay = d.toDateString() === new Date().toDateString();
        return sameDay ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    };
    unsubscribeChat = subscribeMessages(family.id, msgs => {
        const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
        log.innerHTML = msgs.length ? msgs.map(m => {
            const mine = m.senderId === user.uid;
            const canDelete = mine || isHead;
            return `<div class="msg ${mine ? "mine" : ""}">
                <div class="msg-meta"><strong>${mine ? "You" : escapeHTML(m.senderName || "Member")}</strong><span>${time(m.createdAt)}</span>${canDelete ? `<button class="link-btn" data-delete-message="${m.id}" title="Delete message">Delete</button>` : ""}</div>
                <div class="msg-text">${escapeHTML(m.text)}</div>
            </div>`;
        }).join("") : `<p class="muted small center">No messages yet. Say hello to the family.</p>`;
        if (atBottom || msgs.length < 4) log.scrollTop = log.scrollHeight;
    }, error => {
        console.error(error);
        log.innerHTML = `<p class="muted small center">Couldn't load messages.</p>`;
    });
    form.onsubmit = async e => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = "";
        try { await sendMessage(family.id, user, text); }
        catch (error) { console.error(error); input.value = text; }
    };
    input.focus();
}
