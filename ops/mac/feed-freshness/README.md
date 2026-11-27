# Feed-freshness check (Mac launchd job)

This folder holds a copy of the Mac job that checks four feeds: Gişe Kıbrıs, Duyurular, Novest photos and daily-health. It runs four times a day, at 02:30, 08:30, 14:30 and 20:30 Mac local time. If a feed is stale, it sends a Telegram alert. If the check itself cannot run, it sends one combined alert. The copy lives here so the job survives a Mac change. The live files on the Mac are the ones that actually run, so keep both in step.

| File | Installs to |
|---|---|
| `run.mjs` | `~/.local/share/ada-feed-freshness/run.mjs` |
| `../../../scripts/check-feed-freshness.mjs` | `~/.local/share/ada-feed-freshness/check-feed-freshness.mjs` |
| `com.ada.feed-freshness.plist` | `~/Library/LaunchAgents/com.ada.feed-freshness.plist` |

## Needs (not in git)
- Node at `/usr/local/bin/node`, or update `ProgramArguments` in the plist to point at your Node.
- The GitHub App key in `~/.config/ada-claude-code/` (`app-token.mjs` mints the token).
- The Telegram bot token in the Keychain item `ada-telegram-bot`.
- The plist paths use `/Users/berkeustun`. Change them if your home folder is different.

## Install
```bash
mkdir -p ~/.local/share/ada-feed-freshness ~/.local/state/ada-feed-freshness
cp ops/mac/feed-freshness/run.mjs scripts/check-feed-freshness.mjs ~/.local/share/ada-feed-freshness/
cp ops/mac/feed-freshness/com.ada.feed-freshness.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ada.feed-freshness.plist
```
`RunAtLoad` makes it run once straight away. To check the result:
- Look at the end of `~/Library/Logs/ada-feed-freshness.log` for a `stale=0` line.
- Open the vault note `10-ada/alerts/feed-freshness.md`.

To reload after a change:
```bash
launchctl bootout gui/$(id -u)/com.ada.feed-freshness
```
Then run the `bootstrap` line above again.
