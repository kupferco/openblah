/* Guest join flow, shared by desktop and mobile pages. */
(function () {
  const { h, CONSENT, chrome, meter } = OB;
  const mode = document.body.dataset.mode; // desktop | mobile
  const s = { ai: "on", mic: "ok", step: "name" };
  const form = { name: "", consent: false };
  const host = document.getElementById("host");
  let stopMeter = null;

  function render() {
    if (stopMeter) {
      stopMeter();
      stopMeter = null;
    }
    const needConsent = s.ai === "on";
    let body;
    if (s.step === "name") {
      const next = h(
        "button",
        {
          class: "btn primary block",
          disabled: !form.name.trim() || (needConsent && !form.consent),
          onclick: () => {
            s.step = "mic";
            render();
          },
        },
        needConsent ? "Agree and continue" : "Continue",
      );
      body = [
        h("span", { class: "badge" }, "Step 1 of 2"),
        h("h1", {}, "Join Maria's room"),
        h("p", { class: "dim" }, "Maria invited you to a voice call. No account needed."),
        h("input", {
          class: "field",
          placeholder: "Your name",
          value: form.name,
          "aria-label": "Your name",
          oninput: (e) => {
            form.name = e.target.value;
            next.disabled = !form.name.trim() || (needConsent && !form.consent);
          },
        }),
        needConsent
          ? h(
              "label",
              { class: "check" },
              h("input", {
                type: "checkbox",
                checked: form.consent,
                onchange: (e) => {
                  form.consent = e.target.checked;
                  next.disabled = !form.name.trim() || !form.consent;
                },
              }),
              h("span", { class: "small" }, CONSENT),
            )
          : "",
        h("div", { class: "spacer" }),
        next,
        h(
          "button",
          {
            class: "small dim",
            style: "align-self:center;background:none;border:0;padding:8px 16px;min-height:36px",
            onclick: () => {
              s.step = "declined";
              render();
            },
          },
          "Not now",
        ),
      ];
    } else if (s.step === "mic") {
      const m = h("div", { class: "meter" });
      body = [
        h("span", { class: "badge" }, "Step 2 of 2"),
        h("h1", {}, "Check your microphone"),
        s.mic === "ok"
          ? h("p", { class: "dim" }, "Say something. The bars should move.")
          : h(
              "div",
              { class: "notice warn" },
              "OpenBlah can't hear a microphone. Allow microphone access in your browser, then try again.",
            ),
        h(
          "div",
          { class: "card" },
          h("div", { class: "small dim" }, "Built-in microphone"),
          h("div", { style: "height:12px" }),
          m,
        ),
        h("div", { class: "spacer" }),
        h(
          "button",
          {
            class: "btn primary block",
            disabled: s.mic !== "ok",
            onclick: () => {
              s.step = "joined";
              render();
            },
          },
          "Join call",
        ),
        h(
          "button",
          {
            class: "btn block",
            onclick: () => {
              s.step = "name";
              render();
            },
          },
          "Back",
        ),
      ];
      queueMicrotask(() => {
        stopMeter = meter(m, () => s.mic === "ok");
      });
    } else if (s.step === "declined") {
      body = [
        h("div", { class: "spacer" }),
        h("h1", { style: "text-align:center" }, "You didn't join"),
        h(
          "p",
          { class: "dim", style: "text-align:center" },
          "No problem. You can close this page, or use the invite link again any time.",
        ),
        h("div", { class: "spacer" }),
        h(
          "button",
          {
            class: "btn block",
            onclick: () => {
              s.step = "name";
              render();
            },
          },
          "Join after all",
        ),
      ];
    } else {
      // joined: straight to the call screen, which shows "You're in" as a toast
      location.href = "../call/index.html?joined=1";
      return;
    }
    host.replaceChildren(h("div", { class: "screen" }, body));
  }
  const ui = chrome(
    mode === "mobile" ? "Mobile browser join" : "Desktop guest join",
    [
      {
        key: "ai",
        label: "Room's AI",
        options: [
          ["on", "AI on (consent shown)"],
          ["off", "AI off (no consent line)"],
        ],
      },
      {
        key: "mic",
        label: "Microphone",
        options: [
          ["ok", "Working"],
          ["blocked", "Blocked"],
        ],
      },
      {
        key: "step",
        label: "Jump to step",
        options: [
          ["name", "Name"],
          ["mic", "Mic check"],
          ["joined", "Joined"],
          ["declined", "Not now"],
        ],
      },
    ],
    s,
    (k) => {
      if (k === "step" && s.step !== "name" && !form.name) form.name = "Sam";
      render();
    },
  );
  if (s.step !== "name") form.name = "Sam";
  render();
})();
