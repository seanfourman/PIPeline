// The name employers see, on the CV and in its file's name: English letters, with the spaces, hyphens, apostrophes and
// dots names carry ("Jean-Luc O'Neil Jr."). Shared by the server, which refuses any other (user.ts), and the
// introduction, whose field takes nothing else (ui/views/welcome.tsx).
export const ENGLISH_NAME = /^[A-Za-z]+(?:[ '.-]+[A-Za-z]+)*\.?$/;

// What a name field keeps of what was typed or pasted: anything else, Hebrew letters included, never reaches it.
export const englishOnly = (text: string) => text.replace(/[^A-Za-z' .-]/g, "");
