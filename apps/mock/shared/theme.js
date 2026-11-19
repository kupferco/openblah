/* Light/dark theme for the mock. Follows the device setting until the toggle is used.
   Load in <head> so the theme is set before the first paint. */
(function () {
  const KEY = "ob-mock-theme";
  const root = document.documentElement;
  const get = () => {
    try {
      return localStorage.getItem(KEY);
    } catch (e) {
      return null;
    }
  };
  // ?theme=light|dark presets it (used for the screenshots)
  const preset = new URLSearchParams(location.search).get("theme");
  const saved = preset === "light" || preset === "dark" ? preset : get();
  if (saved === "light" || saved === "dark") root.setAttribute("data-theme", saved);
  const effective = () =>
    root.getAttribute("data-theme") ||
    (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  function button() {
    const b = document.createElement("button");
    b.id = "theme-btn";
    b.type = "button";
    const label = () => {
      const light = effective() === "light";
      b.textContent = light ? "☾ Dark" : "☀ Light";
      b.setAttribute("aria-label", light ? "Switch to dark mode" : "Switch to light mode");
    };
    b.addEventListener("click", () => {
      const next = effective() === "light" ? "dark" : "light";
      root.setAttribute("data-theme", next);
      try {
        localStorage.setItem(KEY, next);
      } catch (e) {}
      label();
    });
    matchMedia("(prefers-color-scheme: light)").addEventListener("change", label);
    label();
    return b;
  }
  window.OBTheme = { button };
})();
