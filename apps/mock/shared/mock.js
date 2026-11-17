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
  window.OB = { $, h, CONSENT, PEOPLE, chrome, meter, callView };
})();
