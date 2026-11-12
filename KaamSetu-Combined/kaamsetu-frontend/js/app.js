/* KAAMSETU frontend — language-first, role-based navigation, connected to the KAAMSETU backend API.
   The server is the source of truth: roles, jobs, bookings, attendance and payments all come from API responses.
   The "I am looking for work / I want to hire" choice is navigation only; the real role is the account role from the server. */

const LANG_KEY = "ks_lang";
const PREROLE_KEY = "ks_prerole"; // navigation choice made before sign-up (never grants anything)

let lang = null;
let user = null;            // from GET /auth/me or login (server-controlled)
let preRole = null;         // 'worker' | 'contractor' - only pre-selects the sign-up form
let route = { view: "lang" };
let jobForm = {};           // job being typed (kept in memory across language switches and session expiry)
let draftId = null;         // server draft being edited (from "Repeat this job"/"Continue editing")
let authForm = {};          // sign-up/login fields kept across language switches (never the password)
let langReturn = null;      // where to go back to after changing language
let afterLogin = null;      // where to go back to after re-login
let flash = null;           // one-shot message shown on the next screen
let busy = false;
let renderToken = 0;

/* ---------- storage helpers (graceful when unavailable) ---------- */
const store = {
  get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } },
  set(k,v){ try { localStorage.setItem(k,v); } catch(e){} },
  remove(k){ try { localStorage.removeItem(k); } catch(e){} }
};

/* ---------- i18n helpers ---------- */
function t(key){ return (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key; }
function esc(s){ return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
function sid(id){ return /^[\w-]+$/.test(String(id)) ? String(id) : ""; } // IDs are restricted to safe characters before being embedded in action data
function setDocLang(){ document.documentElement.lang = lang === "hi" ? "hi" : "en"; document.title = t("brand"); }
function locale(){ return lang === "hi" ? "hi-IN" : "en-IN"; }
function fmtMoney(n){
  try { return new Intl.NumberFormat(locale(), {style:"currency",currency:"INR",maximumFractionDigits:0}).format(n); }
  catch(e){ return "₹" + n; }
}
function fmtDate(d){
  if (!d) return "";
  try {
    const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T00:00:00") : new Date(d); // date-only strings are calendar dates, not UTC instants
    return new Intl.DateTimeFormat(locale(), {dateStyle:"medium"}).format(dt);
  } catch(e){ return d; }
}
function errMsg(e){
  if (!e) return t("err_unknown");
  if (e.network) return t("err_network");
  let m = e.status ? (e.message || t("err_unknown")) : t("err_unknown");
  if (e.status >= 500 && e.requestId) m += ` (${t("ref")}: ${e.requestId})`;
  return m;
}

/* ---------- user feedback ---------- */
function msgBox(){
  if (!flash) return `<div id="msg" role="status" aria-live="polite"></div>`;
  const f = flash; flash = null;
  return `<div id="msg" role="status" aria-live="polite"><div class="${f.kind === "ok" ? "success-box" : "error-box"}">${esc(f.text)}</div></div>`;
}
function setMsg(kind, text){
  const el = document.getElementById("msg");
  if (el) { el.innerHTML = `<div class="${kind === "ok" ? "success-box" : "error-box"}">${esc(text)}</div>`; el.scrollIntoView({block:"nearest"}); }
  else flash = { kind, text };
}
function clearMsg(){ const el = document.getElementById("msg"); if (el) el.innerHTML = ""; }
function setBusyUI(on){
  document.body.setAttribute("aria-busy", on ? "true" : "false");
  document.querySelectorAll("#root button").forEach(b => { if (on) { b.dataset.wasDisabled = b.disabled ? "1" : ""; b.disabled = true; } else if (b.dataset.wasDisabled !== undefined) { b.disabled = b.dataset.wasDisabled === "1"; delete b.dataset.wasDisabled; } });
}
/* Runs one action at a time. Buttons stay disabled until the server answers, so nothing is shown as done before it is. */
async function once(fn){
  if (busy) return;
  busy = true; setBusyUI(true);
  try { await fn(); }
  catch(e){ if (!handleAuthError(e)) setMsg("err", errMsg(e)); }
  finally { busy = false; setBusyUI(false); }
}
function handleAuthError(e){ return !!(e && (e.code === "SESSION_EXPIRED" || e.code === "UNAUTHENTICATED") && !KS.hasToken() && !user); }

KS.langProvider = () => lang;
KS.onUnauthorized = () => {
  // Session ended (expired, revoked, or account disabled). Keep what the user typed and send them to log in again.
  if (route.view === "postJob" && route.step !== 2) collectForm();
  if (!["auth","lang","role"].includes(route.view)) afterLogin = { ...route };
  user = null;
  flash = { kind: "err", text: t("session_expired_msg") };
  go("auth", { mode: "login" });
};

/* ---------- routing ---------- */
function go(view, params){ route = { view, ...(params || {}) }; return render(); }
function homeFor(u){ return u.role === "worker" ? "workerHome" : u.role === "contractor" ? "contractorHome" : "adminNotice"; }
function goHome(){ return go(user ? homeFor(user) : (preRole ? "auth" : "role"), user ? {} : { mode: "register" }); }

async function boot(){
  const saved = store.get(LANG_KEY);
  preRole = store.get(PREROLE_KEY);
  if (!saved){ route = { view: "lang" }; return render(); }   // first visit: language before anything else
  lang = saved; setDocLang();
  if (KS.hasToken()){
    route = { view: "boot" }; render();
    try { user = await KS.me(); return go(homeFor(user)); }
    catch(e){ if (e.network){ return go("bootFailed"); } user = null; KS.clearToken(); }
  }
  go("role");
}

/* ---------- templates ---------- */
function topbar(){
  return `<header class="topbar">
    <span class="brand">${esc(t("brand"))}</span>
    <button class="iconbtn" data-action="openLang()" aria-label="${esc(I18N.en.change_lang)} / ${esc(I18N.hi.change_lang)}" title="${esc(I18N.en.change_lang)} / ${esc(I18N.hi.change_lang)}">🌐<span class="sr-only">${esc(I18N.en.change_lang)} / ${esc(I18N.hi.change_lang)}</span></button>
    ${user ? `<button class="iconbtn" data-action="logout()" aria-label="${esc(t("logout"))}" title="${esc(t("logout"))}">⏻<span class="sr-only">${esc(t("logout"))}</span></button>` : ""}
  </header>`;
}
function backBtn(to, p){ return `<button class="back-link" data-action="go('${to}'${p ? "," + p : ""})">← ${esc(t("back"))}</button>`; }
function pill(cls, text){ return `<span class="pill ${cls}">${esc(text)}</span>`; }
function statusPills(j){
  return `<div class="row" style="margin-top:8px">
    ${pill("info", `${t("workers_needed")}: ${j.needed}`)}
    ${pill("ok", `${t("confirmed")}: ${j.confirmed}`)}
    ${pill("bad", `${t("cancelled")}: ${j.cancelled}`)}
    ${pill("warn", `${t("arrival_pending")}: ${j.pending}`)}
    ${pill("ok", `${t("recorded_arrived")}: ${j.arrived}`)}
  </div>`;
}
function jobStatusPill(st){ return pill(st === "open" ? "ok" : st === "draft" ? "info" : "muted", t("st_" + st)); }
function arrivalPill(a){
  const map = { arrival_pending: ["warn","arrival_pending"], self_reported_arrived: ["info","arrival_self_reported"], recorded_arrived: ["ok","recorded_arrived"], recorded_absent: ["bad","recorded_absent"] };
  const m = map[a] || map.arrival_pending; return pill(m[0], t(m[1]));
}
function bookingPill(st){ return pill(st === "confirmed" ? "ok" : st === "needs_reacceptance" ? "warn" : "bad", t("st_" + st)); }
function payPill(p){ return pill(p.status === "acknowledged" ? "ok" : p.status === "disputed" ? "bad" : p.status === "superseded" ? "muted" : "warn", t(p.status_key)); }
function perDay(){ return `<span class="hint">/ ${esc(t("per_day"))}</span>`; }
function loadingHtml(){ return `<div class="app"><main class="content"><p role="status">${esc(t("loading"))}</p></main></div>`; }
function errorHtml(e, retryView, retryParams){
  return `<div class="app">${topbar()}<main class="content">
    <div class="error-box" role="alert">${esc(errMsg(e))}</div>
    <button class="btn" data-action="go('${retryView}'${retryParams ? "," + retryParams : ""})">${esc(t("retry"))}</button>
    <button class="btn ghost" data-action="goHome()">${esc(t("home"))}</button></main></div>`;
}
function emptyCard(key){ return `<div class="card"><p>${esc(t(key))}</p></div>`; }

/* ---------- views ---------- */
const VIEWS = {};

VIEWS.boot = { html: () => `<main class="content"><p role="status">${esc(t("loading"))}</p></main>` };
VIEWS.bootFailed = { html: () => `${topbar()}<main class="content"><div class="error-box" role="alert">${esc(t("err_network"))}</div>
  <button class="btn" data-action="boot()">${esc(t("retry"))}</button></main>` };

VIEWS.lang = { html: () => `<main class="content">
    <div class="card lang-hero"><div class="logo">${esc(t("brand"))}</div><p>${esc(t("tagline"))}</p></div>
    <div class="card">
      <h2>${esc(I18N.en.choose_lang)} / ${esc(I18N.hi.choose_lang)}</h2>
      <button class="lang-option" id="lo-en" aria-pressed="false" data-action="pickLang('en')">English</button>
      <button class="lang-option" id="lo-hi" aria-pressed="false" data-action="pickLang('hi')">हिन्दी</button>
      <p class="hint">${esc(t("language_note"))}</p>
      <button class="btn" data-action="confirmLang()">${esc(I18N.en.continue)} / ${esc(I18N.hi.continue)}</button>
    </div>
    <p class="footer-note">${esc(t("server_note"))}</p></main>` };

VIEWS.role = { html: () => `${topbar()}<main class="content">
    <div class="card"><h2>${esc(t("brand"))}</h2>
      <div class="role-grid">
        <button class="role-btn" data-action="pickRole('worker')">🧑‍🏭<br>${esc(t("i_worker"))}</button>
        <button class="role-btn" data-action="pickRole('contractor')">🏗️<br>${esc(t("i_contractor"))}</button>
      </div>
      <button class="btn ghost" data-action="go('auth',{mode:'login'})">${esc(t("have_account"))} — ${esc(t("login"))}</button>
    </div>
    <p class="footer-note">${esc(t("server_note"))}</p></main>` };

VIEWS.auth = { html: (r) => {
  const mode = r.mode === "login" ? "login" : "register";
  const reg = mode === "register";
  const f = authForm;
  const roleLine = reg && preRole ? `<p class="notice">${esc(t(preRole === "worker" ? "creating_worker" : "creating_contractor"))}
      <button class="back-link" data-action="go('role')" style="margin-left:8px">${esc(t("change_role"))}</button></p>` : "";
  return `${topbar()}<main class="content">
    <div class="row" role="group" aria-label="${esc(t("login"))} / ${esc(t("register"))}">
      <button class="btn ${reg ? "ghost" : ""}" style="flex:1;margin:0" aria-pressed="${!reg}" data-action="switchAuth('login')">${esc(t("login"))}</button>
      <button class="btn ${reg ? "" : "ghost"}" style="flex:1;margin:0" aria-pressed="${reg}" data-action="switchAuth('register')">${esc(t("new_here"))}</button>
    </div>
    ${msgBox()}
    <div class="card" style="margin-top:14px">
      <h2>${esc(reg ? t("register") : t("login"))}</h2>
      ${roleLine}
      ${reg ? `<label for="a-name">${esc(t("name_label"))} *</label><input id="a-name" data-a="name" autocomplete="name" maxlength="80" value="${esc(f.name || "")}">` : ""}
      <label for="a-id">${esc(t("identifier_label"))} *</label>
      <input id="a-id" data-a="identifier" inputmode="email" autocomplete="username" autocapitalize="none" value="${esc(f.identifier || "")}">
      <label for="a-pw">${esc(t("password_label"))} *</label>
      <input id="a-pw" type="password" autocomplete="${reg ? "new-password" : "current-password"}" ${reg ? 'aria-describedby="pw-hint"' : ""}>
      ${reg ? `<p class="hint" id="pw-hint">${esc(t("password_hint"))}</p>` : ""}
      ${reg && preRole === "worker" ? `<label for="a-skills">${esc(t("skills_label"))}</label><input id="a-skills" data-a="skills" maxlength="200" value="${esc(f.skills || "")}"><p class="hint">${esc(t("skills_note"))}</p>` : ""}
      ${reg ? `<label for="a-loc">${esc(t("location_label"))}</label><input id="a-loc" data-a="location" maxlength="120" value="${esc(f.location || "")}">` : ""}
      <div id="form-err" role="alert"></div>
      <button class="btn" data-action="submitAuth('${mode}')">${esc(reg ? t("register") : t("login"))}</button>
    </div></main>`; } };

VIEWS.verifyIdentifier = { html: (r) => `${topbar()}<main class="content"><div class="card"><h2>Verify your ${r.identifier && r.identifier.includes("@") ? "email" : "phone number"}</h2><p>Enter the 6-digit code sent to <strong>${esc(r.identifier || "")}</strong>. The code expires in 10 minutes.</p><label for="v-code">Verification code</label><input id="v-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}"><div id="form-err" role="alert"></div><button class="btn" data-action="submitVerification()">Verify</button><button class="btn ghost" data-action="go('auth',{mode:'login'})">Back to login</button></div></main>` };
VIEWS.adminMfa = { html: (r) => `${topbar()}<main class="content"><div class="card"><h2>${r.setup ? "Set up administrator MFA" : "Administrator MFA"}</h2>${r.setup ? `<p>Install an authenticator app (such as Google Authenticator, Microsoft Authenticator, or 1Password), add an account manually, and enter this secret:</p><p class="notice" style="overflow-wrap:anywhere"><strong>${esc(r.secret || "")}</strong></p><p class="hint">Keep this secret private. It will not be shown again after setup.</p>` : `<p>Enter the current 6-digit code from your authenticator app.</p>`}<label for="mfa-code">Authenticator code</label><input id="mfa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}"><div id="form-err" role="alert"></div><button class="btn" data-action="submitAdminMfa()">${r.setup ? "Enable MFA and sign in" : "Verify and sign in"}</button></div></main>` };

VIEWS.adminNotice = { html: () => `${topbar()}<main class="content"><div class="card"><p>${esc(t("admin_notice"))}</p></div></main>` };

VIEWS.workerHome = { html: () => `${topbar()}<main class="content">${msgBox()}
    <div class="big-grid">
      <button class="big-btn" data-action="go('findWork')"><span class="ico">🔍</span>${esc(t("find_work"))}</button>
      <button class="big-btn" data-action="go('todaysWork')"><span class="ico">📋</span>${esc(t("todays_work"))}</button>
      <button class="big-btn" data-action="go('paymentsW')"><span class="ico">💰</span>${esc(t("my_payments"))}</button>
      <button class="big-btn" data-action="go('help')"><span class="ico">🆘</span>${esc(t("get_help"))}</button>
    </div></main>` };

VIEWS.contractorHome = { html: () => `${topbar()}<main class="content">${msgBox()}
    <div class="big-grid">
      <button class="big-btn" data-action="startPostJob()"><span class="ico">📝</span>${esc(t("hire_workers"))}</button>
      <button class="big-btn" data-action="go('todaysTeam')"><span class="ico">👷</span>${esc(t("todays_team"))}</button>
      <button class="big-btn" data-action="go('paymentsC')"><span class="ico">💳</span>${esc(t("payments"))}</button>
      <button class="big-btn" data-action="go('help')"><span class="ico">🆘</span>${esc(t("get_help"))}</button>
    </div></main>` };

function jobCard(j, forWorker){
  const id = sid(j.id);
  const mine = forWorker && j.my_booking ? (j.my_booking.status === "confirmed" ? pill("ok", t("you_accepted")) : j.my_booking.status === "needs_reacceptance" ? pill("warn", t("needs_reaccept")) : "") : "";
  return `<div class="card">
    <h2>${esc(j.title)}</h2>
    <p class="job-meta">${esc(t("job_skill"))}: ${esc(j.skill)} · ${esc(t("job_location"))}: ${esc(j.location)}</p>
    <p class="job-meta">${fmtDate(j.date)} ${esc(j.time)} · ${esc(t("job_duration"))}: ${esc(j.duration)}</p>
    <p><strong>${fmtMoney(j.wage)}</strong> ${perDay()}</p>
    ${!forWorker ? `<p>${jobStatusPill(j.status)}</p>` : ""}${mine}
    ${statusPills(j)}
    <div class="row" style="margin-top:12px">
      ${forWorker
        ? `<button class="btn secondary" style="margin:0;flex:1" data-action="go('jobDetail',{id:'${id}',from:'findWork'})">${esc(t("view_job"))}</button>`
        : j.status === "draft"
          ? `<button class="btn secondary" style="margin:0;flex:1" data-action="continueDraft('${id}')">${esc(t("continue_draft"))}</button>
             <button class="btn ghost" style="margin:0;flex:1" data-action="discardDraft('${id}')">${esc(t("discard_draft"))}</button>`
          : `<button class="btn secondary" style="margin:0;flex:1" data-action="go('jobTeam',{id:'${id}'})">${esc(t("view_team"))}</button>
             <button class="btn ghost" style="margin:0;flex:1" data-action="repeatJob('${id}')">${esc(t("repeat_job"))}</button>`}
    </div></div>`;
}

VIEWS.findWork = { load: () => KS.get("/jobs"),
  html: (d) => `${topbar()}<main class="content">${backBtn("workerHome")}<h2>${esc(t("find_work"))}</h2>${msgBox()}
    ${d.jobs.length ? d.jobs.map(j => jobCard(j, true)).join("") : emptyCard("no_jobs")}</main>` };

VIEWS.jobDetail = { load: (r) => KS.get("/jobs/" + encodeURIComponent(r.id)),
  html: (d, r) => { const j = d.job, bk = j.my_booking, id = sid(j.id);
    const isWorker = user && user.role === "worker";
    const accepted = bk && bk.status === "confirmed";
    return `${topbar()}<main class="content">${backBtn(r.from || "workerHome")}${msgBox()}
    <div class="card">
      <h2>${esc(j.title)}</h2>
      <p><strong>${fmtMoney(j.wage)}</strong> ${perDay()}</p>
      <p class="job-meta">${esc(t("job_skill"))}: ${esc(j.skill)}</p>
      <p class="job-meta">${esc(t("job_location"))}: ${esc(j.location)}</p>
      <p class="job-meta">${fmtDate(j.date)} · ${esc(j.time)} · ${esc(t("job_duration"))}: ${esc(j.duration)}</p>
      <hr class="divider">
      <p><strong>${esc(t("job_hours"))}:</strong> ${esc(j.hours)}</p>
      <p><strong>${esc(t("job_equipment"))}:</strong> ${esc(j.equipment)}</p>
      <p><strong>${esc(t("job_paytime"))}:</strong> ${esc(j.paytime)}</p>
      <p><strong>${esc(t("job_cancel"))}:</strong> ${esc(j.cancel)}</p>
      ${statusPills(j)}
      ${isWorker ? (accepted
        ? `<div class="success-box">${esc(t("you_accepted"))}</div><button class="btn secondary" data-action="go('todaysWork')">${esc(t("todays_work"))}</button>`
        : `${bk && bk.status === "needs_reacceptance" ? `<div class="notice">${esc(t("needs_reaccept"))}</div>` : ""}
           <div class="notice">${esc(t("agree_note"))}</div>
           <button class="btn" data-action="acceptJob('${id}',${Number(j.terms_version) || 1})">${esc(bk && bk.status === "needs_reacceptance" ? t("accept_again") : t("accept_job"))}</button>`) : ""}
    </div></main>`; } };

VIEWS.todaysWork = { load: () => KS.get("/my/bookings"),
  html: (d) => `${topbar()}<main class="content">${backBtn("workerHome")}<h2>${esc(t("todays_work"))}</h2>${msgBox()}
    ${d.bookings.length ? d.bookings.map(b => { const j = b.job, id = sid(b.id), active = b.status === "confirmed" || b.status === "needs_reacceptance";
      return `<div class="card">
        <h2>${esc(j.title)}</h2>
        <p class="job-meta">${esc(t("job_location"))}: ${esc(j.location)}</p>
        <p class="job-meta">${fmtDate(j.date)} ${esc(j.time)} · ${esc(t("job_duration"))}: ${esc(j.duration)}</p>
        <p><strong>${fmtMoney(j.wage)}</strong> ${perDay()}</p>
        <div class="row">${bookingPill(b.status)} ${b.status === "confirmed" ? arrivalPill(b.arrival_state) : ""}</div>
        <div class="row" style="margin-top:12px">
          <button class="btn secondary" style="margin:0;flex:1" data-action="go('bookingDetail',{id:'${id}',from:'todaysWork'})">${esc(t("booking_details"))}</button>
          ${b.status === "needs_reacceptance" ? `<button class="btn" style="margin:0;flex:1" data-action="go('jobDetail',{id:'${sid(j.id)}',from:'todaysWork'})">${esc(t("accept_again"))}</button>` : ""}
          ${b.status === "confirmed" && b.arrival_state === "arrival_pending" ? `<button class="btn" style="margin:0;flex:1" data-action="selfArrived('${id}')">${esc(t("i_arrived"))}</button>` : ""}
          ${active ? `<button class="btn ghost" style="margin:0;flex:1" data-action="cancelBooking('${id}','todaysWork')">${esc(t("cancel_booking"))}</button>` : ""}
        </div></div>`; }).join("") : emptyCard("no_jobs")}</main>` };

VIEWS.todaysTeam = { load: () => KS.get("/my/jobs"),
  html: (d) => `${topbar()}<main class="content">${backBtn("contractorHome")}<h2>${esc(t("todays_team"))}</h2>${msgBox()}
    ${d.jobs.length ? d.jobs.map(j => jobCard(j, false)).join("") : emptyCard("no_jobs")}</main>` };

VIEWS.jobTeam = { load: async (r) => { const [j, b] = await Promise.all([KS.get("/jobs/" + encodeURIComponent(r.id)), KS.get("/jobs/" + encodeURIComponent(r.id) + "/bookings")]); return { job: j.job, bookings: b.bookings }; },
  html: (d) => { const j = d.job, id = sid(j.id);
    return `${topbar()}<main class="content">${backBtn("todaysTeam")}${msgBox()}
    <div class="card"><h2>${esc(j.title)}</h2>
      <p class="job-meta">${fmtDate(j.date)} ${esc(j.time)} · ${esc(j.location)}</p>
      <p>${jobStatusPill(j.status)}</p>${statusPills(j)}
      <p class="hint">${esc(t("attendance_note"))}</p>
      ${j.status === "open" ? `<div class="row" style="margin-top:8px">
        <button class="btn ghost" style="margin:0;flex:1" data-action="closeJob('${id}')">${esc(t("close_job"))}</button>
        <button class="btn danger" style="margin:0;flex:1" data-action="cancelJob('${id}')">${esc(t("cancel_job"))}</button></div>` : ""}
    </div>
    <h2>${esc(t("team_heading"))}</h2>
    ${d.bookings.length ? d.bookings.map(b => { const bid = sid(b.id), active = b.status === "confirmed";
      return `<div class="card"><strong>${esc(b.worker.name)}</strong>
        ${b.worker.skills_self_declared ? `<p class="job-meta">${esc(b.worker.skills_self_declared)} <span class="hint">(${esc(t("self_declared"))})</span></p>` : ""}
        <div class="row">${bookingPill(b.status)} ${active ? arrivalPill(b.arrival_state) : ""}</div>
        <div class="row" style="margin-top:12px">
          ${active ? `<button class="btn" style="margin:0;flex:1" data-action="markAtt('${bid}','arrived','${id}')">${esc(t("confirm_attendance"))}</button>
          <button class="btn ghost" style="margin:0;flex:1" data-action="markAtt('${bid}','absent','${id}')">${esc(t("mark_absent"))}</button>` : ""}
          <button class="btn secondary" style="margin:0;flex:1" data-action="go('bookingDetail',{id:'${bid}',from:'jobTeam',jobId:'${id}'})">${esc(t("booking_details"))}</button>
        </div></div>`; }).join("") : emptyCard("no_workers")}</main>`; } };

VIEWS.bookingDetail = { load: (r) => KS.get("/bookings/" + encodeURIComponent(r.id)),
  html: (d, r) => { const b = d.booking, j = d.job, s = d.payment_summary, isC = user && user.role === "contractor", id = sid(b.id);
    const back = r.from === "jobTeam" ? backBtn("jobTeam", `{id:'${sid(r.jobId)}'}`) : backBtn(r.from || (isC ? "contractorHome" : "workerHome"));
    const row = (k, v) => `<div class="row" style="justify-content:space-between"><span>${esc(t(k))}</span><strong>${v}</strong></div>`;
    return `${topbar()}<main class="content">${back}${msgBox()}
    <div class="card"><h2>${esc(j.title)}</h2>
      <p class="job-meta">${fmtDate(j.date)} ${esc(j.time)} · ${esc(j.location)}</p>
      <div class="row">${bookingPill(b.status)} ${b.status === "confirmed" ? arrivalPill(b.arrival_state) : ""}</div>
      <hr class="divider">
      <p><strong>${esc(t("job_hours"))}:</strong> ${esc(j.hours)}</p><p><strong>${esc(t("job_equipment"))}:</strong> ${esc(j.equipment)}</p>
      <p><strong>${esc(t("job_paytime"))}:</strong> ${esc(j.paytime)}</p><p><strong>${esc(t("job_cancel"))}:</strong> ${esc(j.cancel)}</p></div>
    <div class="card"><h2>${esc(t("attendance_heading"))}</h2>
      ${d.attendance.length ? d.attendance.map(a => `<p style="margin:6px 0">${fmtDate(a.work_date)} — ${esc(t(a.status === "arrived" ? "att_arrived" : "att_absent"))}
        <span class="hint">(${esc(t(a.source === "contractor" ? "src_contractor" : "src_worker"))})</span></p>`).join("") : `<p>${esc(t("no_attendance"))}</p>`}
      <p class="hint">${esc(t("attendance_note"))}</p></div>
    <div class="card"><h2>${esc(t("pay_summary"))}</h2>
      ${row("agreed_wage", fmtMoney(s.agreed_daily_wage))}${row("days_recorded", s.days_recorded_by_contractor)}${row("earned_wages", fmtMoney(s.earned_wages))}
      ${row("reported_unack", fmtMoney(s.reported_by_contractor_unacknowledged))}${row("ack_amount", fmtMoney(s.acknowledged_by_worker))}
      ${row("disputed_amount", fmtMoney(s.disputed_by_worker))}${row("status_owed", fmtMoney(s.amount_owed))}
      ${s.reported_more_than_earned ? `<p class="notice">${esc(t("reported_more"))}: ${fmtMoney(s.reported_more_than_earned)}</p>` : ""}
      <p class="hint">${esc(t("not_bank_proof"))}</p></div>
    ${isC && b.status !== "cancelled_by_worker" ? `<div class="card"><h2>${esc(t("report_payment"))}</h2>
      <label for="pp-amt">${esc(t("amount_label"))} *</label><input id="pp-amt" type="number" min="1" inputmode="numeric">
      <label for="pp-method">${esc(t("method"))}</label><select id="pp-method"><option value="cash">${esc(t("m_cash"))}</option><option value="upi">${esc(t("m_upi"))}</option><option value="bank">${esc(t("m_bank"))}</option><option value="other">${esc(t("m_other"))}</option></select>
      <label for="pp-date">${esc(t("paid_on"))}</label><input id="pp-date" type="date">
      <label for="pp-note">${esc(t("note_label"))}</label><input id="pp-note" maxlength="300">
      <div id="form-err" role="alert"></div>
      <button class="btn" data-action="reportPayment('${id}')">${esc(t("report_payment"))}</button></div>` : ""}
    </main>`; } };

function payCard(p, isWorker){
  const id = sid(p.id), who = isWorker ? `${t("contractor_label")}: ${p.contractor.name}` : `${t("worker_label")}: ${p.worker.name}`;
  let actions = "";
  if (isWorker && p.status === "reported") actions += `<button class="btn" data-action="ackPayment('${id}')">${esc(t("acknowledge"))}</button>`;
  if (isWorker && (p.status === "reported" || p.status === "acknowledged")) actions += `<details><summary class="btn ghost" style="margin-top:14px">${esc(t("dispute"))}</summary>
    <label for="dr-${id}">${esc(t("dispute_reason"))}</label><textarea id="dr-${id}" maxlength="500"></textarea>
    <button class="btn" data-action="disputePayment('${id}')">${esc(t("send"))}</button></details>`;
  if (!isWorker && p.status === "disputed") actions += `<details><summary class="btn ghost" style="margin-top:14px">${esc(t("respond"))}</summary>
    <label for="rp-${id}">${esc(t("your_reply"))}</label><textarea id="rp-${id}" maxlength="500"></textarea>
    <button class="btn" data-action="respondPayment('${id}')">${esc(t("send"))}</button></details>`;
  if (!isWorker && (p.status === "reported" || p.status === "disputed")) actions += `<details><summary class="btn ghost" style="margin-top:14px">${esc(t("correct_payment"))}</summary>
    <label for="ca-${id}">${esc(t("amount_label"))}</label><input id="ca-${id}" type="number" min="1" inputmode="numeric" value="${Number(p.amount) || ""}">
    <label for="cr-${id}">${esc(t("correction_reason"))}</label><input id="cr-${id}" maxlength="300">
    <button class="btn" data-action="correctPayment('${id}')">${esc(t("send"))}</button></details>`;
  return `<div class="card">
    <div class="row"><strong style="flex:1">${esc(p.job_title)}</strong><span>${fmtMoney(p.amount)}</span></div>
    <p class="job-meta">${esc(who)} · ${esc(t("paid_on"))}: ${fmtDate(p.paid_on)} · ${esc(t("method"))}: ${esc(t("m_" + p.method))}</p>
    ${p.note ? `<p class="job-meta">${esc(p.note)}</p>` : ""}
    <p style="margin:8px 0 0">${payPill(p)}</p>
    ${p.status === "disputed" && p.dispute_reason ? `<p class="notice"><strong>${esc(t("dispute_label"))}:</strong> ${esc(p.dispute_reason)}</p>` : ""}
    <div id="act-${id}">${actions}</div>
    <p class="row" style="margin-top:10px"><button class="back-link" data-action="go('bookingDetail',{id:'${sid(p.booking_id)}',from:'${isWorker ? "paymentsW" : "paymentsC"}'})">${esc(t("booking_details"))} →</button></p></div>`;
}
VIEWS.paymentsW = { load: () => KS.get("/payments"),
  html: (d) => `${topbar()}<main class="content">${backBtn("workerHome")}<h2>${esc(t("payment_history"))}</h2>${msgBox()}
    <p class="hint">${esc(t("not_bank_proof"))}</p>${d.payments.length ? d.payments.map(p => payCard(p, true)).join("") : emptyCard("no_payments")}</main>` };
VIEWS.paymentsC = { load: () => KS.get("/payments"),
  html: (d) => `${topbar()}<main class="content">${backBtn("contractorHome")}<h2>${esc(t("payment_history"))}</h2>${msgBox()}
    <p class="hint">${esc(t("not_bank_proof"))}</p>${d.payments.length ? d.payments.map(p => payCard(p, false)).join("") : emptyCard("no_payments")}</main>` };

VIEWS.help = { load: () => KS.get("/help"),
  html: (d) => `${topbar()}<main class="content">${backBtn(user && user.role === "worker" ? "workerHome" : "contractorHome")}<h2>${esc(t("get_help"))}</h2>${msgBox()}
    <div class="card"><p>${esc(t("help_text"))}</p><p class="notice">${esc(t("help_emergency"))}</p>
      <label for="h-cat">${esc(t("help_category"))}</label>
      <select id="h-cat"><option value="payment">${esc(t("c_payment"))}</option><option value="booking">${esc(t("c_booking"))}</option><option value="account">${esc(t("c_account"))}</option><option value="other">${esc(t("c_other"))}</option></select>
      <label for="h-msg">${esc(t("help_message"))} *</label><textarea id="h-msg" maxlength="1000"></textarea>
      <p class="hint">${esc(t("help_not_confidential"))}</p>
      <div id="form-err" role="alert"></div>
      <button class="btn" data-action="sendHelp()">${esc(t("send"))}</button></div>
    ${d.help.length ? `<h2>${esc(t("my_requests"))}</h2>${d.help.map(h => `<div class="card"><p class="job-meta">${esc(t("c_" + h.category))} · ${fmtDate(h.created_at)}</p><p>${esc(h.message)}</p>
      <p>${pill(h.status === "resolved" ? "ok" : h.status === "in_progress" ? "info" : "warn", t("hs_" + h.status))}</p>
      ${h.response ? `<p class="notice"><strong>${esc(t("support_reply"))}:</strong> ${esc(h.response)}</p>` : ""}</div>`).join("")}` : ""}</main>` };

const JOB_FIELDS = [
  ["title","job_title","text"],["skill","job_skill","text"],["wage","job_wage","number"],
  ["location","job_location","text"],["date","job_date","date"],["time","job_time","time"],
  ["duration","job_duration","text"],["hours","job_hours","text"],
  ["equipment","job_equipment","text"],["paytime","job_paytime","text"],["cancel","job_cancel","textarea"],
  ["needed","job_needed","number"],
];
const JOB_REQUIRED = ["title","skill","wage","location","date","time","duration","hours","equipment","paytime","cancel","needed"];

VIEWS.postJob = { html: (r) => { const step = r.step || 1;
  if (step === 1) return `${topbar()}<main class="content">${backBtn("contractorHome")}<h2>${esc(t("post_job"))}</h2>${msgBox()}
    <div class="card">
      ${JOB_FIELDS.map(([k,tk,ty]) => `
        <label for="f-${k}">${esc(t(tk))}${JOB_REQUIRED.includes(k) ? " *" : ""}</label>
        ${ty === "textarea"
          ? `<textarea id="f-${k}" data-k="${k}" maxlength="500">${esc(jobForm[k] || "")}</textarea>`
          : `<input id="f-${k}" type="${ty}" data-k="${k}" value="${esc(jobForm[k] ?? (k === "needed" ? 3 : ""))}" ${ty === "number" ? 'min="1" inputmode="numeric"' : ""}>`}
      `).join("")}
      <p class="hint">${esc(t("required_note"))}</p>
      <div id="form-err" role="alert"></div>
      <button class="btn" data-action="postStep2()">${esc(t("next"))}</button>
    </div></main>`;
  return `${topbar()}<main class="content">${backBtn("postJob", "{step:1}")}<h2>${esc(t("review_job"))}</h2>${msgBox()}
    <div class="card">
      ${JOB_FIELDS.map(([k,tk]) => `<p><strong>${esc(t(tk))}:</strong> ${k === "wage" ? fmtMoney(jobForm.wage) : k === "date" ? fmtDate(jobForm.date) : esc(jobForm[k])}</p>`).join("")}
      <div class="notice">${esc(t("agree_note"))}</div>
      <div id="form-err" role="alert"></div>
      <button class="btn" data-action="publishJob()">${esc(t("post_job"))}</button>
      <button class="btn ghost" data-action="go('postJob',{step:1})">${esc(t("back"))}</button>
    </div></main>`; } };

/* ---------- render ---------- */
function paint(inner, wrap = true){
  const root = document.getElementById("root");
  root.innerHTML = wrap ? `<div class="app">${inner}</div>` : inner;
  window.scrollTo(0, 0);
  const h = root.querySelector("main h2, main .logo");
  if (h) { h.setAttribute("tabindex", "-1"); try { h.focus({ preventScroll: true }); } catch(e){} }
  if (route.view === "lang"){ const cur = pendingLang || lang; if (cur) pickLang(cur); }
}
async function render(){
  const my = ++renderToken;
  const v = VIEWS[route.view] || VIEWS.lang;
  const needsUser = !["lang","role","auth","verifyIdentifier","adminMfa","boot","bootFailed"].includes(route.view);
  if (needsUser && !user){ route = { view: "role" }; return render(); }
  if (needsUser && user){
    const roleOk = (user.role === "worker" && !["contractorHome","todaysTeam","jobTeam","paymentsC","postJob"].includes(route.view))
      || (user.role === "contractor" && !["workerHome","findWork","todaysWork","paymentsW"].includes(route.view))
      || (user.role === "admin" && route.view === "adminNotice");
    if (!roleOk){ route = { view: homeFor(user) }; return render(); } // the server enforces this too; this only avoids dead-end screens
  }
  if (v.load){
    paint(loadingHtml(), false);
    let data;
    try { data = await v.load(route); }
    catch(e){ if (my !== renderToken) return; if (handleAuthError(e)) return; const keep = { ...route }; paint(errorHtml(e, keep.view, keep.id ? `{id:'${sid(keep.id)}'}` : ""), false); return; }
    if (my !== renderToken) return;
    paint(v.html(data, route));
  } else paint(v.html(route));
}

/* ---------- language ---------- */
let pendingLang = null;
function pickLang(l){ pendingLang = l; document.querySelectorAll(".lang-option").forEach(b => b.setAttribute("aria-pressed", b.id === "lo-" + l ? "true" : "false")); }
function openLang(){
  // Keep whatever is being typed, then come back to exactly this screen afterwards.
  if (route.view === "postJob" && (route.step || 1) === 1) collectForm();
  if (route.view === "auth") collectAuth();
  langReturn = { ...route }; pendingLang = lang; go("lang");
}
async function confirmLang(){
  const l = pendingLang || store.get(LANG_KEY) || "en";
  store.set(LANG_KEY, l); lang = l; setDocLang();
  if (user) { KS.put("/me", { lang: l }).catch(() => {}); } // remember it on the account too; failure does not matter
  const back = langReturn; langReturn = null;
  if (back && back.view !== "lang" && (user || ["role","auth"].includes(back.view))) return go(back.view, back);
  if (user) return go(homeFor(user));
  return go("role");
}

/* ---------- accounts ---------- */
function pickRole(r){ preRole = r; store.set(PREROLE_KEY, r); go("auth", { mode: "register" }); }
function collectAuth(){ document.querySelectorAll("[data-a]").forEach(el => { authForm[el.dataset.a] = el.value.trim(); }); }
function switchAuth(mode){ collectAuth(); if (mode === "register" && !preRole) return go("role"); go("auth", { mode }); }
function submitAuth(mode){ return once(async () => {
  collectAuth(); clearMsg();
  const pw = document.getElementById("a-pw").value;
  const err = document.getElementById("form-err");
  if (!authForm.identifier || !pw || (mode === "register" && !authForm.name)) { err.innerHTML = `<div class="error-box">${esc(t("err_required"))}</div>`; return; }
  let result;
  try {
    result = mode === "login"
      ? await KS.login(authForm.identifier, pw)
      : await KS.register({ identifier: authForm.identifier, password: pw, name: authForm.name, role: preRole, lang, skills: authForm.skills || "", location: authForm.location || "" });
  } catch(e){ err.innerHTML = `<div class="error-box">${esc(errMsg(e))}</div>`; return; }
  if (result && result.verification_required) { authForm.identifier = result.identifier || authForm.identifier; return go("verifyIdentifier", { identifier: authForm.identifier }); }
  if (result && (result.mfa_required || result.mfa_setup_required)) return go("adminMfa", { setup: !!result.mfa_setup_required, challengeToken: result.challenge_token, secret: result.secret || "" });
  user = result && result.user ? result.user : result;
  authForm = {};
  const back = afterLogin; afterLogin = null;
  if (back && back.view && back.view !== "auth") { route = back; return render(); } // router re-checks role access
  go(homeFor(user));
}); }
function submitVerification(){ return once(async () => {
  const code = (document.getElementById("v-code") || {}).value || "";
  const identifier = route.identifier || authForm.identifier || "";
  if (!/^\d{6}$/.test(code)) { const e = document.getElementById("form-err"); if(e) e.innerHTML = `<div class="error-box">Enter the 6-digit code.</div>`; return; }
  await KS.confirmVerification(identifier, code);
  authForm.identifier = identifier;
  flash = { kind: "ok", text: "Identity verified. Sign in to continue." };
  go("auth", { mode: "login" });
}); }
function submitAdminMfa(){ return once(async () => {
  const code = (document.getElementById("mfa-code") || {}).value || "";
  if (!/^\d{6}$/.test(code)) { const e = document.getElementById("form-err"); if(e) e.innerHTML = `<div class="error-box">Enter the 6-digit authenticator code.</div>`; return; }
  user = await KS.completeAdminMfa(!!route.setup, route.challengeToken, code);
  const back = afterLogin; afterLogin = null;
  if (back && back.view && back.view !== "auth") { route = back; return render(); }
  go(homeFor(user));
}); }

async function logout(){
  let failed = false;
  try { await KS.logout(); } catch(e){ failed = true; KS.clearToken(); }
  user = null; afterLogin = null; jobForm = {}; draftId = null; authForm = {};
  if (failed) flash = { kind: "err", text: t("logout_failed_warning") };
  go("role");
}

/* ---------- worker actions ---------- */
function acceptJob(id, termsVersion){ return once(async () => {
  await KS.post(`/jobs/${id}/accept`, { accept_terms: true, terms_version: termsVersion });
  flash = { kind: "ok", text: t("accepted_ok") }; await go("todaysWork");
}); }
function selfArrived(id){ return once(async () => {
  await KS.post(`/bookings/${id}/attendance`, {});
  flash = { kind: "ok", text: t("arrival_reported_ok") }; await go("todaysWork");
}); }
function cancelBooking(id, back){ if (!confirm(t("confirm_cancel"))) return; return once(async () => {
  await KS.post(`/bookings/${id}/cancel`, {});
  flash = { kind: "ok", text: t("cancelled_ok") }; await go(back);
}); }
function ackPayment(id){ return once(async () => { await KS.post(`/payments/${id}/acknowledge`, {}); flash = { kind: "ok", text: t("ack_ok") }; await go("paymentsW"); }); }
function disputePayment(id){ return once(async () => {
  const reason = document.getElementById("dr-" + id).value.trim();
  if (!reason) throw Object.assign(new Error(t("err_required")), { status: 422 });
  await KS.post(`/payments/${id}/dispute`, { reason }); flash = { kind: "ok", text: t("dispute_ok") }; await go("paymentsW");
}); }
function sendHelp(){ return once(async () => {
  const message = document.getElementById("h-msg").value.trim();
  if (!message) { document.getElementById("form-err").innerHTML = `<div class="error-box">${esc(t("err_required"))}</div>`; return; }
  await KS.post("/help", { category: document.getElementById("h-cat").value, message });
  flash = { kind: "ok", text: t("help_sent") }; await go("help");
}); }

/* ---------- contractor actions ---------- */
function collectForm(){ document.querySelectorAll("[data-k]").forEach(el => { jobForm[el.dataset.k] = el.value.trim(); }); }
function startPostJob(){ jobForm = {}; draftId = null; go("postJob", { step: 1 }); }
function postStep2(){
  collectForm();
  if (JOB_REQUIRED.some(k => !jobForm[k])) { document.getElementById("form-err").innerHTML = `<div class="error-box">${esc(t("err_required"))}</div>`; return; }
  go("postJob", { step: 2 });
}
function jobPayload(){ const o = {}; JOB_FIELDS.forEach(([k]) => { o[k] = jobForm[k]; }); return o; }
function publishJob(){ return once(async () => {
  if (draftId) { // a draft made by "Repeat this job": update it, then publish it after explicit review
    await KS.patch(`/jobs/${draftId}`, jobPayload());
    await KS.post(`/jobs/${draftId}/publish`, { confirm_reviewed: true });
  } else {
    await KS.post("/jobs", { ...jobPayload(), publish: true, confirm_reviewed: true });
  }
  jobForm = {}; draftId = null;
  flash = { kind: "ok", text: t("published") }; await go("todaysTeam");
}); }
function loadDraft(job){
  jobForm = { title: job.title, skill: job.skill, wage: job.wage ?? "", location: job.location, date: job.date, time: job.time,
    duration: job.duration, hours: job.hours, equipment: job.equipment, paytime: job.paytime, cancel: job.cancel, needed: job.needed };
  draftId = job.id;
}
function repeatJob(id){ return once(async () => {
  const d = await KS.post(`/jobs/${id}/repeat`, {}); // server copies details only: no workers, attendance or payments; date is cleared
  loadDraft(d.job); flash = { kind: "ok", text: t("draft_copied") }; await go("postJob", { step: 1 });
}); }
function continueDraft(id){ return once(async () => { const d = await KS.get(`/jobs/${id}`); loadDraft(d.job); await go("postJob", { step: 1 }); }); }
function discardDraft(id){ if (!confirm(t("confirm_cancel_job"))) return; return once(async () => { await KS.post(`/jobs/${id}/cancel`, {}); await go("todaysTeam"); }); }
function markAtt(bookingId, status, jobId){ return once(async () => {
  await KS.post(`/bookings/${bookingId}/attendance`, { status });
  flash = { kind: "ok", text: t("attendance_saved") }; await go("jobTeam", { id: jobId });
}); }
function closeJob(id){ return once(async () => { await KS.post(`/jobs/${id}/close`, {}); flash = { kind: "ok", text: t("job_closed_ok") }; await go("jobTeam", { id }); }); }
function cancelJob(id){ if (!confirm(t("confirm_cancel_job"))) return; return once(async () => {
  await KS.post(`/jobs/${id}/cancel`, {}); flash = { kind: "ok", text: t("job_cancelled_ok") }; await go("todaysTeam");
}); }
function reportPayment(bookingId){ return once(async () => {
  const amount = document.getElementById("pp-amt").value.trim(), paid = document.getElementById("pp-date").value;
  if (!amount) { document.getElementById("form-err").innerHTML = `<div class="error-box">${esc(t("err_required"))}</div>`; return; }
  const body = { amount, method: document.getElementById("pp-method").value, note: document.getElementById("pp-note").value.trim() };
  if (paid) body.paid_on = paid;
  await KS.post(`/bookings/${bookingId}/payments`, body);
  flash = { kind: "ok", text: t("payment_reported_ok") }; await go("bookingDetail", { ...route });
}); }
function respondPayment(id){ return once(async () => {
  const message = document.getElementById("rp-" + id).value.trim();
  if (!message) throw Object.assign(new Error(t("err_required")), { status: 422 });
  await KS.post(`/payments/${id}/respond`, { message }); flash = { kind: "ok", text: t("reply_ok") }; await go("paymentsC");
}); }
function correctPayment(id){ return once(async () => {
  const amount = document.getElementById("ca-" + id).value.trim(), reason = document.getElementById("cr-" + id).value.trim();
  if (!amount || !reason) throw Object.assign(new Error(t("err_required")), { status: 422 });
  await KS.post(`/payments/${id}/correct`, { amount, reason }); flash = { kind: "ok", text: t("correct_ok") }; await go("paymentsC");
}); }

/* ---------- boot ---------- */
document.addEventListener("DOMContentLoaded", boot);


/* CSP-safe action dispatch. data-action is parsed as a tiny literal-only call language; no eval/Function. */
(function installActionDispatcher(){
  const allowed = new Set(['openLang','logout','go','goHome','boot','pickLang','confirmLang','pickRole','switchAuth','submitAuth','continueDraft','discardDraft','repeatJob','acceptJob','selfArrived','cancelBooking','cancelJob','closeJob','markAtt','reportPayment','ackPayment','disputePayment','respondPayment','correctPayment','sendHelp','startPostJob','postStep2','publishJob','submitVerification','submitAdminMfa']);
  function parseCall(src){
    let i=0;
    const ws=()=>{while(/\s/.test(src[i]||'')&&i<src.length)i++;};
    function string(){const q=src[i++];let out='';while(i<src.length){const c=src[i++];if(c===q)return out;if(c==='\\'){const n=src[i++];out+=n==='n'?'\n':n==='r'?'\r':n==='t'?'\t':n;}else out+=c;}throw Error('bad string');}
    function value(){ws();const c=src[i];if(c==="'"||c==='"')return string();if(c==='{'){i++;const o={};ws();if(src[i]==='}'){i++;return o;}while(i<src.length){ws();let k;if(src[i]==="'"||src[i]==='"')k=string();else{const m=/^[A-Za-z_$][\w$]*/.exec(src.slice(i));if(!m)throw Error('bad key');k=m[0];i+=k.length;}ws();if(src[i++]!==':')throw Error('missing colon');o[k]=value();ws();if(src[i]==='}'){i++;return o;}if(src[i++]!==',')throw Error('missing comma');}throw Error('bad object');}const n=/^-?\d+(?:\.\d+)?/.exec(src.slice(i));if(n){i+=n[0].length;return Number(n[0]);}for(const [word,val] of [['true',true],['false',false],['null',null]])if(src.slice(i,i+word.length)===word){i+=word.length;return val;}throw Error('unsupported literal');}
    ws();const fn=/^[A-Za-z_$][\w$]*/.exec(src.slice(i));if(!fn)throw Error('bad function');i+=fn[0].length;ws();if(src[i++]!=='(')throw Error('missing call');const args=[];ws();if(src[i]===')'){i++;return {fn:fn[0],args};}while(i<src.length){args.push(value());ws();if(src[i]===')'){i++;ws();if(i!==src.length)throw Error('trailing');return {fn:fn[0],args};}if(src[i++]!==',')throw Error('missing separator');}throw Error('incomplete');
  }
  document.addEventListener('click', ev=>{const el=ev.target.closest('[data-action]');if(!el)return;let call;try{call=parseCall(el.getAttribute('data-action'));}catch(e){return;}if(!allowed.has(call.fn)||typeof window[call.fn]!=='function')return;ev.preventDefault();window[call.fn](...call.args);});
})();
