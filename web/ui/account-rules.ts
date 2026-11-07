// What a new account's name and password need. The computer holds to it as it makes the account (auth.ts), and the
// board that makes it shows it as it is typed (login.tsx). The name is what signing in on Pip's site takes too, so its
// rule is the site's own (site/store.ts; ui.test.ts keeps the two the same): a letter or a digit first, then those,
// dots, underscores, dashes and spaces, up to NAME_MAX in all. The password: PASSWORD_MIN characters or more, not one
// of the 10,000 most common passwords (public/common-passwords.txt holds those as long as that, from SecLists' list),
// and without the name in it. No mix of kinds of characters is asked for: that makes a password harder to remember,
// not harder to guess.
export const NAME_RULE = /^[\p{L}\p{N}][\p{L}\p{N}._ -]{0,39}$/u;
export const NAME_MAX = 40;
export const PASSWORD_MIN = 8;
// A name this long or longer counts when the password has it in it; a shorter one only when it is the whole password.
const NAME_IN_PASSWORD = 3;

export type NameProblem = { problem: "" | "empty" | "long" | "start" | "char"; char?: string };

// What is wrong with a name typed for the account: nothing (""), none typed, too long, its first character, or the
// first character it can't have.
export function nameProblem(typed: string): NameProblem {
  const chars = [...typed.trim()];
  if (!chars.length) return { problem: "empty" };
  if (chars.length > NAME_MAX) return { problem: "long" };
  if (!/^[\p{L}\p{N}]$/u.test(chars[0])) return { problem: "start" };
  const char = chars.find((c) => !/^[\p{L}\p{N}._ -]$/u.test(c));
  return char ? { problem: "char", char } : { problem: "" };
}

export type PasswordChecks = { long: boolean; common: boolean; name: boolean };

// Each of the password's rules, true while it holds: long enough, not one of the common passwords (common holds them
// in lower case, as the list has them), and without the account's name.
export function passwordChecks(password: string, name: string, common: ReadonlySet<string>): PasswordChecks {
  const typed = password.toLowerCase();
  const who = name.trim().toLowerCase();
  return {
    long: [...password].length >= PASSWORD_MIN,
    common: !common.has(typed),
    name: !who || (typed !== who && ([...who].length < NAME_IN_PASSWORD || !typed.includes(who))),
  };
}

// The first rule the password breaks, as the computer's error for it, or "".
export function passwordError(password: string, name: string, common: ReadonlySet<string>) {
  const checks = passwordChecks(password, name, common);
  return !checks.long ? "account_password" : !checks.common ? "account_password_common" : !checks.name ? "account_password_name" : "";
}

// The common passwords from the list's text, one a line.
export const commonPasswords = (text: string) => new Set(text.split("\n").map((line) => line.trim()).filter(Boolean));
