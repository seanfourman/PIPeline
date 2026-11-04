// Runs before the first paint: the theme and language picked last time, so the loading screen already shows in
// them. ui/app.tsx keeps them in step after that. While the English version and the dark theme are off (the same
// two as LANGUAGES_ON and THEMES_ON in ui/app.tsx), it is Hebrew and light whatever was picked.
const LANGUAGES_ON = false;
const THEMES_ON = false;
try {
  const theme = THEMES_ON ? localStorage.getItem("theme") : "light";
  if (theme) document.documentElement.dataset.theme = theme;
  const lang = LANGUAGES_ON && localStorage.getItem("lang") === "en" ? "en" : "he";
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
} catch {
  // Storage is off; the page's defaults stand.
}

// Drawing without the graphics card (hardware acceleration off, or the GPU unavailable), the moving sky and the
// blurs behind glass get very slow, so the page goes lite (html.lite in styles.css): the same look, still. A
// WebGL context that refuses to start on a major performance caveat is how the browser says it is drawing in
// software.
try {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl", { failIfMajorPerformanceCaveat: true }) || canvas.getContext("experimental-webgl", { failIfMajorPerformanceCaveat: true });
  if (!gl) document.documentElement.classList.add("lite");
  else gl.getExtension("WEBGL_lose_context")?.loseContext();
} catch {
  document.documentElement.classList.add("lite");
}
