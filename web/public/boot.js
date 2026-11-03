// Runs before the first paint: the theme and language picked last time, so the loading screen already shows in
// them. ui/app.tsx keeps them in step after that.
try {
  const theme = localStorage.getItem("theme");
  if (theme) document.documentElement.dataset.theme = theme;
  const lang = localStorage.getItem("lang") === "en" ? "en" : "he";
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
} catch {
  // Storage is off; the page's defaults stand.
}
