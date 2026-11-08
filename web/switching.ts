// Imported first by server.ts, before upgrade.ts and anything else that reads user/: the account asked for before Pip
// stopped is opened (accounts.ts), the link to the site moves out of the account's folder to the computer's own files,
// and the open account gets its id if it has none.
import { applySwitch, ensureIds, moveComputerFiles } from "./accounts";

const switched = applySwitch();
if (switched !== "none") console.log(switched === "switched" ? "Opened the account asked for." : "Couldn't open the account asked for; the one open before stays open.");
moveComputerFiles();
ensureIds();
