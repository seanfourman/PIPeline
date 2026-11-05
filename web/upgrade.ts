// Imported first by server.ts, so it runs before any module reads the user's folder (agent.ts restores the saved
// conversations as it loads): the files an older version kept elsewhere in the project move into user/, and a new
// user gets the starting files (user.ts).
import { ensureUserFolder, moveToUserFolder } from "./user";

const { moved, kept } = moveToUserFolder();
if (moved.length) console.log(`Moved ${moved.length} of your files into user/.`);
for (const rel of kept) console.log(`Left ${rel} where it is: user/ already has a file by that name.`);
ensureUserFolder();
