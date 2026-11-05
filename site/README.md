# The site

Where a phone reaches its owner's computer. The app on each computer links once under its account's name (Settings, Phone access) and then keeps a connection open to the site, so nothing at home is opened to the internet. On a phone the owner opens the site and signs in with the same username and password; the site passes the sign-in to the computer, which checks it, and from then on passes that phone's requests along the connection. The phone gets the whole app, the conversations' live updates too.

## What it keeps

Only each linked computer's name and a hash of the key it connects with (`store.ts`, SQLite). No password, and none of the owner's files: those stay on the computer. Everything the phone and the computer send passes through it, so it must run behind HTTPS.

## Running it

```bash
bun site/server.ts
```

| Variable | Default | What it sets |
|---|---|---|
| `PORT` | `4180` | Where it listens |
| `DATA_DIR` | `site/data` | Where `site.db` is kept (must survive restarts and redeploys) |

On the computer, the app offers the site's address from `PIP_SITE` before one is linked; the address can also be typed in the settings.

## Files

- `server.ts`: the routes: the sign-in, linking and unlinking a computer, the computers' connections, and passing a phone's requests on.
- `relay.ts`: the requests and answers along each computer's connection, streamed, a phone that leaves cancelling its request.
- `store.ts`: the linked computers.
- `pages.ts`: the site's own pages, the sign-in and the note that the computer is off.

The tests are in `web/remote.test.ts`, which runs the site with the app's side of the connection (`web/remote.ts`).
