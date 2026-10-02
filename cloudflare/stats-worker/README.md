# FoxFW statistics Worker

The small Cloudflare Worker behind the **Statistics** panel on the FoxFW
Web Installer (`flasher.html`), the Fox ESP32 Web Flasher
(`fox-esp32-flasher.html`) and the FAP Compiler (`fap-compiler.html`).

Live at `https://foxfw-stats.foxcustomfirmware.workers.dev`.

## What it stores

One row per unique combination of the fields below, with a counter. Nothing
else is written anywhere.

| Column | Example | Where it comes from |
|---|---|---|
| `app` | `esp32`, `foxfw`, `fap` | which page sent the tally |
| `day` | `2026-10-02` | the Worker's clock, UTC |
| `country` | `AU` | Cloudflare's country code for the request |
| `target` | `ESP32-S2`, `tgz`, `fap` | chip (ESP32 flasher) or install method (FoxFW installer) |
| `fw` | `1.4.0`, `custom` | firmware version, or `custom` for a user-supplied file |
| `result` | `ok`, `fail` | whether it finished |
| `stage` | `connect`, `flash`, `build` | where a failed attempt stopped |
| `link` | `usb-otg`, `uart` | how the ESP32 was connected |
| `os` | `Windows` | operating system family, reduced from the User-Agent |
| `browser` | `Chrome` | browser family, reduced from the User-Agent |
| `n` | `14` | how many times that combination happened |

The FAP Compiler also keeps a second table, `fap_repos`, so the page can show
which apps people compile: one row per day and GitHub repository
(`owner/repo`), with how many builds succeeded and failed, and when the
latest one was. It has no country, browser or other columns. A repository
is listed only if the build actually ran (it succeeded, or failed at the
build step) and GitHub does not answer "not found" for it. To keep a
repository out of the public list, add its lower-case `owner/repo` to
`HIDDEN_REPOS` at the top of `index.js` and redeploy.

**Not stored:** IP addresses, full User-Agent strings, cookies, device or
serial numbers, MAC addresses, the branch or subfolder typed into the FAP
Compiler, or anything else that identifies a person or a device. The visitor's IP
address is used in memory only, for a short rate limit, and is never written
to the database or to a log by this code. Cloudflare's own request logging
for this Worker is switched off (step 5 below) for the same reason.

Every value a page sends is checked against a fixed list (or a version
pattern) before it is stored, so free text can never end up in the public
statistics.

## Endpoints

- `POST /hit` — body is JSON sent as `text/plain`:
  `{"app":"esp32","target":"ESP32-S2","fw":"1.4.0","result":"ok","stage":"","link":"usb-otg"}`.
  The FAP Compiler adds `"repo":"owner/name"`. Only accepted from
  `https://foxfw.github.io`. Returns `204`.
- `GET /stats?app=esp32&month=2026-10` — public JSON for one month of one
  app (totals, per-day, per-country and the other breakdowns), plus the list
  of months that have data and all-time totals. For `app=fap` it also returns
  the most compiled and most recently compiled repositories. Readable from
  any origin.

## Deploying (Cloudflare dashboard, no CLI)

1. **Storage & databases → D1 SQL database → Create Database**, name it
   `foxfw-stats`.
2. **Workers & Pages → Create → Start with Hello World!**, name it
   `foxfw-stats`, **Deploy**.
3. Open the Worker → **Bindings → Add binding → D1 database**. Variable name
   `DB`, database `foxfw-stats`.
4. **Edit code**, replace everything with `index.js` from this folder,
   **Deploy**.
5. **Settings → Observability**, switch **Logs** off and **Deploy**. New
   Workers have request logging on by default, and those logs include
   request details such as the visitor's address. With Logs off, Cloudflare
   keeps no per-request log for this Worker.

The Worker creates its own tables on first use. If the Worker is given a
different name, change `ENDPOINT` at the top of `assets/js/fox-stats.js` to
match.

To update the Worker later, repeat step 4.

## Adding another page or another value

- New allowed value (a new chip, a new firmware target): add it to the
  matching list in `APPS` at the top of `index.js` and redeploy. Anything not
  on a list is rejected with `400` and is not counted.
- New page: add an entry to `APPS` here and to `APPS` in
  `assets/js/fox-stats.js`, include the script on the page, call
  `FoxStats.init({ app, mount })` and `FoxStats.report({...})`.
