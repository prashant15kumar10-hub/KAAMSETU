#!/usr/bin/env python3
"""Real-browser end-to-end test for KAAMSETU (Chromium via Playwright).
Starts the backend on a temporary database serving the frontend folder, then drives the UI like a user.
Requires: pip install playwright && playwright install chromium     Run:  python3 e2e/run_e2e.py
"""
import os, re, subprocess, sys, tempfile, time, json, socket, sqlite3, shutil, urllib.request
from playwright.sync_api import sync_playwright, expect

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND = os.path.join(ROOT, "kaamsetu-backend"); FRONTEND = os.path.join(ROOT, "kaamsetu-frontend")
results = []

def step(name):
    def deco(fn):
        try: fn(); results.append((name, True, "")); print("PASS", name)
        except Exception as e: results.append((name, False, repr(e)[:600])); print("FAIL", name, "->", repr(e)[:600])
        return fn
    return deco

def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p

tmpdir = tempfile.mkdtemp(prefix="ks-e2e-"); dbfile = os.path.join(tmpdir, "e2e.db"); port = free_port()
env = dict(os.environ, PORT=str(port), DB_PATH=dbfile, STATIC_DIR=FRONTEND, LOG_LEVEL="warn")
srv = subprocess.Popen(["node", "--no-warnings", "src/server.js"], cwd=BACKEND, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
BASE = f"http://127.0.0.1:{port}"
for _ in range(50):
    try: urllib.request.urlopen(BASE + "/api/ready", timeout=1); break
    except Exception: time.sleep(0.2)
else: print("server did not start"); srv.kill(); sys.exit(2)

def api_count(sql, *a):
    c = sqlite3.connect(dbfile); n = c.execute(sql, a).fetchone()[0]; c.close(); return n

errors = []   # unexpected JS errors / CSP violations
def new_page(ctx):
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" and "Content Security Policy" in m.text else None)
    return pg

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={"width": 390, "height": 800}, locale="en-IN")
    # Google Fonts are not reachable in the sandbox: answer with empty CSS so they do not add noise.
    ctx.route(re.compile(r"https://fonts\.(googleapis|gstatic)\.com/.*"), lambda r: r.fulfill(status=200, body="", content_type="text/css"))
    ctx.set_default_timeout(5000); ctx.set_default_navigation_timeout(8000)
    page = new_page(ctx)
    pw_ = "Passw0rd!x"

    def submit_login(ident):
        page.fill("#a-id", ident); page.fill("#a-pw", pw_); page.click("button[onclick^=\"submitAuth\"]")
    def login(ident):
        tab = page.locator("button[onclick=\"switchAuth('login')\"]")
        if tab.count(): tab.click()
        else: page.click("button:has-text('I already have an account')")
        submit_login(ident)

    def fill_job(p, title="Bricklaying", date=None, needed="2"):
        date = date or time.strftime("%Y-%m-%d")
        vals = {"title": title, "skill": "Brick mason", "wage": "850", "location": "Sector 12, Gurugram", "date": date, "time": "08:00",
                "duration": "8 days", "hours": "8 hrs, 1 hr lunch", "equipment": "Contractor provides tools", "paytime": "Same day", "cancel": "Cancel before 6 PM", "needed": needed}
        for k, v in vals.items(): p.fill(f"#f-{k}", v)

    @step("first visit shows language selection before login/role; Hindi works; document language set")
    def _():
        page.goto(BASE + "/")
        expect(page.locator("text=Choose your language")).to_be_visible()
        assert page.locator("text=I am looking for work").count() == 0 and page.locator("input").count() == 0
        page.click("#lo-hi"); page.click("button.btn:has-text(\"आगे बढ़ें\")")
        expect(page.locator("text=मुझे काम चाहिए")).to_be_visible()
        assert page.evaluate("document.documentElement.lang") == "hi"
        assert page.evaluate("localStorage.getItem('ks_lang')") == "hi"

    @step("language can be changed from any screen and returns to the same screen")
    def _():
        page.click("button.iconbtn[onclick='openLang()']"); page.click("#lo-en"); page.click("button.btn:has-text(\"Continue\")")
        expect(page.locator("text=I am looking for work")).to_be_visible()
        assert page.evaluate("document.documentElement.lang") == "en"

    @step("contractor registers (real account) and lands on contractor home with 4 actions")
    def _():
        page.click("text=I want to hire workers")
        page.fill("#a-name", "Suresh Contractor"); page.fill("#a-id", "suresh@example.com"); page.fill("#a-pw", pw_)
        page.click("button[onclick^=\"submitAuth\"]")
        expect(page.locator("text=Hire workers")).to_be_visible()
        for k in ["Hire workers", "Today's team", "Payments", "Get help"]: assert page.locator(f".big-btn:has-text(\"{k}\")").count() == 1
        assert api_count("select count(*) from users where role='contractor'") == 1

    @step("weak password / duplicate account show server messages without losing typed data")
    def _():
        page.click("button.iconbtn[onclick='logout()']")
        page.click("text=I want to hire workers"); page.fill("#a-name", "Dup"); page.fill("#a-id", "suresh@example.com"); page.fill("#a-pw", pw_)
        page.click("button[onclick^=\"submitAuth\"]")
        expect(page.locator("#form-err .error-box")).to_be_visible()
        assert page.input_value("#a-name") == "Dup" and page.input_value("#a-id") == "suresh@example.com"
        page.fill("#a-pw", "short"); page.click("button[onclick^=\"submitAuth\"]")
        expect(page.locator("#form-err .error-box")).to_be_visible()
        login("suresh@example.com")
        expect(page.locator(".big-btn:has-text('Hire workers')")).to_be_visible()

    @step("switching language mid-form keeps what was typed")
    def _():
        page.click(".big-btn:has-text('Hire workers')")
        page.fill("#f-title", "Plastering <b>x</b>"); page.fill("#f-wage", "900")
        page.click("button.iconbtn[onclick='openLang()']"); page.click("#lo-hi"); page.click("button.btn:has-text(\"आगे बढ़ें\")")
        assert page.input_value("#f-title") == "Plastering <b>x</b>" and page.input_value("#f-wage") == "900"
        expect(page.locator("label[for=f-title]")).to_contain_text("काम का प्रकार")
        page.click("button.iconbtn[onclick='openLang()']"); page.click("#lo-en"); page.click("button.btn:has-text(\"Continue\")")
        assert page.input_value("#f-title") == "Plastering <b>x</b>"

    @step("required fields enforced; review step; publish saves a real job on the server")
    def _():
        page.click("button.btn:has-text('Next')")
        expect(page.locator("#form-err .error-box")).to_be_visible()
        fill_job(page, title="Bricklaying")
        page.click("button.btn:has-text('Next')")
        expect(page.locator("h2:has-text('Review job details')")).to_be_visible()
        page.click("button.btn:has-text('Post a job')")
        expect(page.locator(".success-box")).to_contain_text("Job posted")
        expect(page.locator(".card h2:has-text('Bricklaying')")).to_be_visible()
        assert api_count("select count(*) from jobs where status='open'") == 1
        expect(page.locator("text=Workers needed: 2")).to_be_visible()

    @step("a dropped response + retry never creates a duplicate job (idempotent retry)")
    def _():
        page.click("button.back-link"); page.click(".big-btn:has-text('Hire workers')")
        fill_job(page, title="Site cleaning"); page.click("button.btn:has-text('Next')")
        state = {"n": 0}
        def handler(route):
            if route.request.method == "POST" and route.request.url.endswith("/api/jobs"):
                state["n"] += 1
                if state["n"] == 1:
                    route.fetch()      # the server DID process it...
                    route.abort()      # ...but the phone never got the answer
                    return
            route.continue_()
        page.route("**/api/jobs", handler)
        page.click("button.btn:has-text('Post a job')")
        expect(page.locator(".error-box")).to_be_visible()   # honest failure message, form still there
        assert api_count("select count(*) from jobs where title='Site cleaning'") == 1
        page.click("button.btn:has-text('Post a job')")      # retry
        expect(page.locator(".success-box")).to_contain_text("Job posted")
        page.unroute("**/api/jobs")
        assert api_count("select count(*) from jobs where title='Site cleaning'") == 1, "duplicate job created"

    @step("script injection in job text is shown as text, never executed")
    def _():
        page.click("button.back-link"); page.click(".big-btn:has-text('Hire workers')")
        fill_job(page, title="<img src=x onerror=window.__xss=1>"); page.click("button.btn:has-text('Next')"); page.click("button.btn:has-text('Post a job')")
        expect(page.locator(".success-box")).to_be_visible(); page.wait_for_timeout(300)
        assert page.evaluate("window.__xss") is None
        assert "<img src=x" in page.inner_text("main")

    @step("worker registers, finds job, must read the terms, accepts, self-reports arrival (labelled unverified)")
    def _():
        page.click("button.iconbtn[onclick='logout()']")
        page.click("text=I am looking for work")
        page.fill("#a-name", "Ramesh"); page.fill("#a-id", "9876543210"); page.fill("#a-pw", pw_); page.fill("#a-skills", "Brick mason")
        page.click("button[onclick^=\"submitAuth\"]")
        expect(page.locator(".big-btn:has-text('Find work')")).to_be_visible()
        page.click(".big-btn:has-text('Find work')")
        expect(page.locator(".card h2:has-text('Bricklaying')")).to_have_count(1)
        page.locator(".card:has(h2:has-text('Bricklaying')) button:has-text('View details')").click()
        for k in ["Working hours", "Equipment responsibilities", "Payment timing", "Cancellation terms"]: expect(page.locator(f"strong:has-text('{k}')")).to_have_count(1)
        page.click("button.btn:has-text('I accept these terms')")
        expect(page.locator(".success-box")).to_contain_text("does not guarantee attendance")
        assert api_count("select count(*) from bookings where status='confirmed'") == 1
        page.click("button:has-text('I have arrived')")
        expect(page.locator("text=You reported arrival (not verified)").first).to_be_visible()

    @step("contractor: team view, confirm attendance, report payment; worker acknowledges; second payment disputed, replied, corrected")
    def _():
        page.click("button.iconbtn[onclick='logout()']")
        login("suresh@example.com")
        page.click(".big-btn:has-text(\"Today's team\")")
        page.locator(".card:has(h2:has-text('Bricklaying')) button:has-text('View team')").first.click()
        expect(page.locator("strong:has-text('Ramesh')")).to_be_visible()
        expect(page.locator("text=skills they told us")).to_have_count(1)
        page.click("button:has-text('Confirm attendance')")
        expect(page.locator(".success-box")).to_contain_text("Attendance saved")
        expect(page.locator("text=Recorded as arrived").first).to_be_visible()
        page.click("button:has-text('Details and payments')")
        expect(page.locator("text=Wage summary")).to_be_visible()
        page.fill("#pp-amt", "500"); page.click("button.btn:has-text('Report a payment')")
        expect(page.locator(".success-box")).to_contain_text("Payment recorded")
        page.fill("#pp-amt", "350"); page.click("button.btn:has-text('Report a payment')")
        expect(page.locator(".success-box")).to_be_visible()
        assert page.locator("text=They are not bank proof").count() >= 1 or page.locator("text=not bank proof").count() >= 1
        # worker side
        page.click("button.iconbtn[onclick='logout()']"); login("9876543210")
        page.click(".big-btn:has-text('My payments')")
        expect(page.locator(".pill:has-text('Payment reported by contractor')")).to_have_count(2)
        page.locator(".card:has-text('₹500') button:has-text('I received this payment')").click()
        expect(page.locator(".success-box")).to_contain_text("acknowledgement is saved")
        page.locator(".card:has-text('₹350') summary:has-text('This is wrong')").click()
        page.fill("textarea[id^=dr-]", "I only received 300"); page.locator(".card:has-text('₹350') button:has-text('Send')").click()
        expect(page.locator(".success-box")).to_contain_text("dispute is saved")
        expect(page.locator(".pill:has-text('Disputed')")).to_be_visible()
        expect(page.locator("text=I only received 300")).to_be_visible()
        # contractor replies + corrects
        page.click("button.iconbtn[onclick='logout()']"); login("suresh@example.com")
        page.click(".big-btn:has-text('Payments')")
        expect(page.locator("text=I only received 300")).to_be_visible()
        page.locator("summary:has-text('Reply to the dispute')").click(); page.fill("textarea[id^=rp-]", "Paid 350 in cash")
        page.locator("button:has-text('Send')").first.click(); expect(page.locator(".success-box")).to_contain_text("Reply saved")
        page.locator("summary:has-text('Correct the amount')").click(); page.fill("input[id^=ca-]", "300"); page.fill("input[id^=cr-]", "Worker was right")
        page.locator("details[open] button:has-text('Send')").click(); expect(page.locator(".success-box")).to_contain_text("Correction saved")
        assert api_count("select count(*) from payments where status='superseded'") == 1
        assert api_count("select count(*) from payments where amount=300 and status='reported'") == 1

    @step("repeat job: new draft with date cleared, needs review, publishes only after explicit post")
    def _():
        page.click("button.back-link"); page.click(".big-btn:has-text(\"Today's team\")")
        before = api_count("select count(*) from jobs where status='open'")
        page.locator(".card:has(h2:has-text('Bricklaying')) button:has-text('Repeat this job')").first.click()
        expect(page.locator("#f-title")).to_have_value("Bricklaying")
        assert page.input_value("#f-date") == ""
        assert api_count("select count(*) from jobs where status='draft'") == 1
        assert api_count("select count(*) from jobs where status='open'") == before
        tomorrow = time.strftime("%Y-%m-%d", time.localtime(time.time() + 86400)); page.fill("#f-date", tomorrow)
        page.click("button.btn:has-text('Next')"); page.click("button.btn:has-text('Post a job')")
        expect(page.locator(".success-box")).to_be_visible()
        assert api_count("select count(*) from jobs where status='open'") == before + 1
        assert api_count("select count(*) from bookings b join jobs j on j.id=b.job_id where j.source_job_id is not null") == 0, "repeat must not copy workers"

    @step("session expiry sends user to login, keeps the typed form, and returns to it after login")
    def _():
        page.click("button.back-link"); page.click(".big-btn:has-text('Hire workers')")
        fill_job(page, title="After expiry job"); page.click("button.btn:has-text('Next')")
        c = sqlite3.connect(dbfile); c.execute("update sessions set revoked=1"); c.commit(); c.close()
        page.click("button.btn:has-text('Post a job')")
        expect(page.locator(".error-box")).to_contain_text("session ended")
        assert api_count("select count(*) from jobs where title='After expiry job'") == 0
        submit_login("suresh@example.com")
        expect(page.locator("h2:has-text('Review job details')")).to_be_visible()   # back where they were
        page.click("button.btn:has-text('Post a job')")
        expect(page.locator(".success-box")).to_be_visible()
        assert api_count("select count(*) from jobs where title='After expiry job'") == 1

    @step("help: message saved, labelled not confidential, no false confidentiality promise, emergency number shown")
    def _():
        page.click("button.back-link"); page.click(".big-btn:has-text('Get help')")
        expect(page.locator("main")).to_contain_text("112")
        body = page.inner_text("main")
        assert "not confidential" in body and "kept confidential" not in body
        page.fill("#h-msg", "Worker did not arrive"); page.click("button.btn:has-text('Send')")
        expect(page.locator(".success-box")).to_contain_text("support")
        assert api_count("select count(*) from help_requests") == 1

    @step("role separation: a worker session cannot use contractor API even from the browser console")
    def _():
        page.click("button.iconbtn[onclick='logout()']"); login("9876543210")
        expect(page.locator(".big-btn:has-text('Find work')")).to_be_visible()
        status = page.evaluate("""async () => { try { await KS.post('/jobs', {title:'x', publish:true}); return 200; } catch(e){ return e.status; } }""")
        assert status == 403, status

    @step("accessibility basics: labelled fields, 48px touch targets on primary buttons, no colour-only status")
    def _():
        page.click(".big-btn:has-text('Find work')") if page.locator(".big-btn:has-text('Find work')").count() else None
        page.goto(BASE + "/")  # reload keeps session via sessionStorage
        expect(page.locator(".big-btn:has-text('Find work')")).to_be_visible()
        for b in page.locator(".big-btn").all(): assert b.bounding_box()["height"] >= 48
        page.click(".big-btn:has-text('Get help')")
        for el in page.locator("main input, main select, main textarea").all():
            i = el.get_attribute("id"); assert i and page.locator(f"label[for={i}]").count() == 1, i
        page.goto(BASE + "/"); page.click(".big-btn:has-text('My payments')")
        for p in page.locator(".pill").all(): assert p.inner_text().strip(), "pill without text"

    @step("no JavaScript errors or CSP violations during the whole run")
    def _():
        assert not errors, errors[:5]

    browser.close()

srv.terminate()
try: srv.wait(5)
except Exception: srv.kill()
shutil.rmtree(tmpdir, ignore_errors=True)
failed = [r for r in results if not r[1]]
print(f"\nE2E: {len(results)-len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
