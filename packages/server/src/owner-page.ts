/*
 * The owner settings screen: one static page, served at `GET /owner`. The product owner pastes
 * their product API key; it stays in this page's memory (never stored, never in the URL) and is
 * only sent as a bearer token to this server's `/v1/product/settings`. It shows who pays, the
 * per-user minute cap and counts (never names or keys), and changes the first two.
 */
export const OWNER_PAGE_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export const OWNER_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>OpenBlah: who pays</title>
<style>
  :root { color-scheme: light dark; --fg:#1b1b1f; --bg:#fafafa; --card:#fff; --line:#d8d8de; --accent:#3b5bdb; --muted:#5d5d6a; }
  @media (prefers-color-scheme: dark) { :root { --fg:#ececf1; --bg:#16161a; --card:#202026; --line:#3a3a44; --accent:#8da2ff; --muted:#a0a0ae; } }
  body { margin:0; font:16px/1.45 system-ui,sans-serif; background:var(--bg); color:var(--fg); }
  main { max-width:560px; margin:0 auto; padding:20px 16px 48px; }
  h1 { font-size:1.4rem; margin:0 0 4px; } h2 { font-size:1.05rem; margin:0 0 8px; }
  p { margin:4px 0 12px; } .muted { color:var(--muted); font-size:.92rem; }
  section { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px; margin:14px 0; }
  label.opt { display:block; border:1px solid var(--line); border-radius:10px; padding:10px 12px; margin:8px 0; cursor:pointer; }
  label.opt:has(input:checked) { border-color:var(--accent); }
  label.opt b { display:block; }
  input[type=text], input[type=password], input[type=number] { width:100%; box-sizing:border-box; padding:10px; font:inherit; border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--fg); }
  button { font:inherit; padding:10px 16px; border-radius:10px; border:1px solid var(--accent); background:var(--accent); color:#fff; cursor:pointer; margin-top:10px; }
  button[disabled] { opacity:.5; }
  dl { display:grid; grid-template-columns:1fr auto; gap:6px 12px; margin:0; } dd { margin:0; font-weight:600; text-align:right; }
  #err { color:#c92a2a; } #ok { color:#2b8a3e; } [hidden] { display:none !important; }
</style>
</head>
<body>
<main>
  <h1>Who pays for voice</h1>
  <p class="muted">For the owner of a product. Paste your product API key to see and change this product's settings. The key stays in this page only.</p>

  <section id="login">
    <label for="key">Product API key</label>
    <input id="key" type="password" autocomplete="off" spellcheck="false">
    <button id="load" type="button">Open settings</button>
  </section>

  <p id="err" role="alert"></p>

  <div id="panel" hidden>
    <section>
      <h2>Who pays</h2>
      <p class="muted">A change applies to the next voice start. Calls in progress finish.</p>
      <p id="unset" class="muted" hidden>Not chosen yet: this server's default order applies. Pick one below.</p>
      <div id="modes"></div>
      <h2>Minutes per user each month</h2>
      <p class="muted">The most agent minutes one person can use per month. 0 turns the cap off.</p>
      <input id="cap" type="number" min="0" step="1" inputmode="numeric">
      <button id="save" type="button">Save</button>
      <p id="ok" role="status"></p>
    </section>

    <section>
      <h2>Right now</h2>
      <dl>
        <dt>Users with their own key</dt><dd id="own">0</dd>
        <dt>Users asked for a key (30 days)</dt><dd id="asked">0</dd>
        <dt>Minutes on the product key (this month)</dt><dd id="mins">0</dd>
      </dl>
      <p class="muted">Counts only. No names and no keys are shown. Test accounts are left out.</p>
    </section>
  </div>
</main>
<script>
(function () {
  var MODES = [
    ["user_key", "Users add their own key", "Nobody costs you anything. Users are asked for a key on first voice start."],
    ["product_trial", "Free allowance, then their own key", "Your key pays up to a small allowance per user, then they add their own."],
    ["product", "My key pays for everyone", "Best for early testing. Keep a monthly minutes cap per user."]
  ];
  var key = "";
  var $ = function (id) { return document.getElementById(id); };
  var modesEl = $("modes");
  MODES.forEach(function (m) {
    var l = document.createElement("label"); l.className = "opt";
    var r = document.createElement("input"); r.type = "radio"; r.name = "mode"; r.value = m[0];
    var b = document.createElement("b"); b.textContent = m[1];
    var s = document.createElement("span"); s.className = "muted"; s.textContent = m[2];
    r.addEventListener("change", function () { $("ok").textContent = ""; });
    l.appendChild(r); l.appendChild(b); l.appendChild(s); modesEl.appendChild(l);
  });
  function call(method, body) {
    return fetch("/v1/product/settings", {
      method: method,
      headers: Object.assign({ authorization: "Bearer " + key }, body ? { "content-type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) throw new Error(res.status === 401 ? "That key was not accepted." : (j.error || "Something went wrong."));
        return j;
      });
    });
  }
  function show(s) {
    var p = s.product || {};
    document.querySelectorAll("input[name=mode]").forEach(function (r) { r.checked = r.value === p.whoPays; });
    $("unset").hidden = !!p.whoPays;
    $("cap").value = p.userMonthlyMinutes == null ? 0 : p.userMonthlyMinutes;
    $("own").textContent = String(p.usersWithOwnKey || 0);
    $("asked").textContent = String(p.keyRequiredUsers30d || 0);
    $("mins").textContent = String(p.productKeyMinutesThisMonth || 0);
    $("login").hidden = true; $("panel").hidden = false;
  }
  function fail(e) { $("err").textContent = e.message; }
  $("load").addEventListener("click", function () {
    $("err").textContent = ""; key = $("key").value.trim();
    if (!key) return fail(new Error("Paste your product API key."));
    call("GET").then(show, fail);
  });
  $("save").addEventListener("click", function () {
    $("err").textContent = ""; $("ok").textContent = "";
    var sel = document.querySelector("input[name=mode]:checked");
    var cap = Number($("cap").value);
    if (!sel) return fail(new Error("Pick who pays."));
    if (!Number.isFinite(cap) || cap < 0) return fail(new Error("Minutes must be 0 or more."));
    call("PUT", { settings: { whoPays: sel.value, userMonthlyMinutes: cap } }).then(function (s) {
      show(s); $("ok").textContent = "Saved. It applies from the next voice start.";
    }, fail);
  });
})();
</script>
</body>
</html>
`;
