/* Shared helpers for the clickable mock. Fake data only; nothing here talks to a network. */
(function () {
  const $ = (sel, el) => (el || document).querySelector(sel);
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v === false || v == null) continue;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat())
      el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return el;
  }
  const CONSENT =
    "An AI listens to this call and takes notes. Audio is not saved. Transcript and summary are saved in the call history for everyone in the call.";
  const PEOPLE = [
    { name: "You", initials: "Y" },
    { name: "Maria", initials: "M" },
    { name: "Tom", initials: "T" },
    { name: "Ana", initials: "A" },
  ];

  /* Top bar + state switcher. groups: [{key,label,options:[[value,label]]}] */
  function chrome(title, groups, state, onChange) {
    const bar = h(
      "div",
      { class: "mock-bar" },
      h("a", { href: "../index.html" }, "← Index"),
      h("span", { class: "title" }, title),
      groups.length
        ? h("button", { id: "states-btn", onclick: () => panel.classList.toggle("open") }, "States")
        : "",
      window.OBTheme ? window.OBTheme.button() : "",
    );
    const panel = h("div", { class: "states", id: "states" });
    // ?key=value in the URL presets a state (also used for the screenshots)
    for (const [k, v] of new URLSearchParams(location.search)) {
      if (k in state)
        state[k] = v === "true" ? true : v === "false" ? false : /^\d+$/.test(v) ? Number(v) : v;
    }
    function draw() {
      panel.replaceChildren(
        ...groups.map((g) =>
          h(
            "div",
            { class: "group" },
            h("span", {}, g.label),
            g.options.map(([v, l]) =>
              h(
                "button",
                {
                  class: "chip",
                  "aria-pressed": String(state[g.key] === v),
                  onclick: () => {
                    state[g.key] = v;
                    draw();
                    onChange(g.key);
                  },
                },
                l,
              ),
            ),
          ),
        ),
      );
    }
    draw();
    document.body.prepend(panel);
    document.body.prepend(bar);
    // ?states=1 opens the panel (used for screenshots)
    if (new URLSearchParams(location.search).has("states")) panel.classList.add("open");
    return { redraw: draw };
  }

  /* Small message at the top of the screen, gone after ms (default 3 s). */
  function toast(text, ms) {
    const el = h("div", { class: "toast", role: "status" }, text);
    document.body.append(el);
    setTimeout(() => el.remove(), ms || 3000);
  }

  /* Fake mic level meter; returns stop(). */
  function meter(el, active) {
    const bars = Array.from({ length: 20 }, () => h("i"));
    el.replaceChildren(...bars);
    let t = 0;
    const tick = () => {
      t += 1;
      const lvl = active()
        ? Math.max(0, Math.min(20, Math.round(8 + 7 * Math.sin(t / 2) + 4 * Math.sin(t * 1.7))))
        : 0;
      bars.forEach((b, i) => {
        b.className = i < lvl ? (i > 15 ? "on hot" : "on") : "";
      });
    };
    tick();
    const id = setInterval(tick, 120);
    return () => clearInterval(id);
  }

  /* Call view, shared by the call page and the standalone app.
     s = {people:2-4, agent:'listening'|'thinking'|'speaking'|'off', mutedOther:bool, selfMuted:bool, speaker:index} */
  function callView(s, actions) {
    const root = h("div", { class: "call" });
    const n = Math.max(2, Math.min(4, s.people));
    const others = PEOPLE.slice(1, n);
    const agentLabel = {
      listening: "Listening",
      thinking: "Thinking…",
      speaking: "Speaking",
      off: "AI is off",
    }[s.agent];
    const agent = h(
      "div",
      { class: "agent " + s.agent },
      h(
        "div",
        { class: "orb" },
        h("span", { class: "ring r1" }),
        h("span", { class: "ring r2" }),
        h("span", { class: "core" }, s.agent === "off" ? "⏸" : "✦"),
      ),
      h("div", { class: "agent-name" }, "Blah ", h("span", { class: "badge ai" }, "AI")),
      h("div", { class: "agent-state" }, agentLabel),
      s.agent === "speaking"
        ? h(
            "div",
            { class: "caption" },
            "“Maria, the flight lands at 14:20, so you have time for lunch first.”",
          )
        : s.agent === "thinking"
          ? h("div", { class: "caption dim" }, "Looking that up…")
          : "",
    );
    const tile = (p, i) => {
      const muted = i === 0 ? s.selfMuted : s.mutedOther && i === 1;
      const speaking = !muted && s.agent !== "speaking" && s.speaker === i;
      return h(
        "div",
        { class: "tile" },
        h(
          "div",
          { class: "avatar" + (speaking ? " speaking" : "") },
          p.initials,
          muted ? h("span", { class: "mic-off" }, "✕") : "",
        ),
        h("div", { class: "pname" }, p.name, muted ? h("span", { class: "dim" }, " · muted") : ""),
      );
    };
    const grid = h(
      "div",
      { class: "people n" + n },
      [PEOPLE[0], ...others].map((p, i) => tile(p, i)),
    );
    root.append(
      h(
        "div",
        { class: "call-top row" },
        h("span", { class: "badge live" }, "● 04:12"),
        h("span", { class: "spacer" }),
        h("span", { class: "small dim" }, n + " people" + (s.agent === "off" ? "" : " + AI")),
      ),
      s.agent === "off"
        ? h("div", { class: "notice warn" }, "AI is off for this room. Everyone can still talk.")
        : "",
      h("div", { class: "agent-wrap" }, agent),
      grid,
      h(
        "div",
        { class: "controls" },
        h(
          "button",
          {
            class: "ctl" + (s.selfMuted ? " off" : ""),
            onclick: actions.mute,
            "aria-label": "Mute",
          },
          s.selfMuted ? "🔇" : "🎙️",
          h("small", {}, s.selfMuted ? "Unmute" : "Mute"),
        ),
        h(
          "button",
          { class: "ctl", onclick: actions.ai, "aria-label": "Pause AI" },
          s.agent === "off" ? "▶" : "⏸",
          h("small", {}, s.agent === "off" ? "Bring AI in" : "Pause AI"),
        ),
        actions.invite
          ? h(
              "button",
              { class: "ctl", onclick: actions.invite, "aria-label": "Invite" },
              "➕",
              h("small", {}, "Invite"),
            )
          : "",
        h(
          "button",
          { class: "ctl leave", onclick: actions.leave, "aria-label": "Leave" },
          "✆",
          h("small", {}, "Leave"),
        ),
      ),
    );
    return root;
  }

  /* Fake finished calls. Used by the app's History and by the guest's "View call history". */
  const CALLS = {
    family: {
      name: "Family chat",
      when: "Just now",
      who: "Maria, Tom",
      dur: "6 min",
      ai: true,
      summary:
        "Maria and Tom planned the weekend: lunch first, then the 14:20 flight pick-up. Tom brings the car seat.",
      transcript: [
        ["Maria", "00:04", "Hi all. Can we sort out Saturday?"],
        ["Tom", "00:11", "Sure. What time does the flight land?"],
        ["Blah", "00:19", "The flight lands at 14:20, so you have time for lunch first."],
        ["Maria", "00:31", "Perfect. Tom, can you bring the car seat?"],
        ["Tom", "00:38", "Yes, I'll put it in the car tonight."],
      ],
    },
    sync: {
      name: "Project sync",
      when: "Yesterday",
      who: "Tom, Ana",
      dur: "32 min",
      ai: true,
      summary: "Agreed to ship the invite flow on Friday; Tom owns the consent text.",
      transcript: [
        ["Ana", "00:06", "Where are we on the invite flow?"],
        ["Tom", "00:15", "Nearly done. The consent text still needs a final pass."],
        ["Blah", "00:27", "Noted: Tom owns the consent text. Target is Friday."],
        ["Ana", "00:40", "Good. Let's ship it Friday then."],
      ],
    },
    us: {
      name: "Just us",
      when: "Mon",
      who: "Maria",
      dur: "12 min",
      ai: false,
      summary: "",
      transcript: [],
    },
  };

  /* Call detail: summary + transcript. back = optional {label, onclick}. */
  function callDetail(c, back) {
    return h(
      "div",
      { class: "screen" },
      back
        ? h(
            "button",
            {
              class: "btn",
              "aria-label": "Back",
              style: "align-self:flex-start;min-height:36px",
              onclick: back,
            },
            "←",
          )
        : "",
      h("h1", {}, c.name),
      h("p", { class: "small dim" }, c.when + " · " + c.who + " · " + c.dur),
      c.ai
        ? [
            h("h2", {}, "Summary"),
            h("div", { class: "card small" }, c.summary),
            h("h2", {}, "Transcript"),
            h(
              "div",
              { class: "list" },
              c.transcript.map(([who, at, text]) =>
                h(
                  "div",
                  { class: "card small" },
                  h(
                    "b",
                    {},
                    who,
                    " ",
                    who === "Blah" ? h("span", { class: "badge ai" }, "AI") : "",
                    h("span", { class: "dim" }, " · " + at),
                  ),
                  h("p", {}, text),
                ),
              ),
            ),
          ]
        : h("div", { class: "notice warn" }, "No notes: the AI was off for this call."),
    );
  }
  window.OB = { $, h, CONSENT, PEOPLE, CALLS, chrome, meter, toast, callView, callDetail };
})();
