# sunday-lights

A small program for the booth PC that sets the church's 27 house lights to the
Sunday levels on a Lutron RadioRA 2 Main Repeater. It serves one page on the
church network with one big button, "Set Sunday lights", that the iPad opens;
after a tap it shows each light as the repeater reports it. Standard library
only, Go 1.22 or later.

## Sunday morning

For the person at the booth PC who has not seen this before. You need the PC on
the church network (the same one the lighting repeater and the iPad are on).

1. Download the one file for your computer from the release page
   <https://github.com/Jonathan-A-White/night-stack/releases/tag/sunday-lights-latest>:
   - A Mac: open the Apple menu > About This Mac. If it says "Chip: Apple M..."
     (M1, M2, M3 or later) download `sunday-lights-mac-apple-silicon`. If it
     says "Processor: Intel ..." download `sunday-lights-mac-intel`.
   - A Windows PC: download `sunday-lights-windows.exe`.
2. Run it. The program is not signed, so the computer will refuse it the first
   time:
   - Mac: in Terminal, go to the Downloads folder, make the file runnable, and
     start it. The first time macOS says it cannot verify the program. Open
     System Settings > Privacy & Security, scroll down to the message about
     the program, click Open Anyway, and start it again. Or skip that by
     removing the quarantine mark first, in Terminal:

     ```
     cd ~/Downloads
     chmod +x sunday-lights-mac-apple-silicon
     xattr -d com.apple.quarantine sunday-lights-mac-apple-silicon
     ./sunday-lights-mac-apple-silicon
     ```

     (Use `sunday-lights-mac-intel` instead on an Intel Mac.)
   - Windows: double-click `sunday-lights-windows.exe`. If a blue "Windows
     protected your PC" box appears, click More info, then Run anyway. When
     Windows Firewall asks whether to allow it, tick Private networks and click
     Allow access.
3. The first time, it asks a few things in its window:
   - It looks for the repeater by itself, for up to half a minute. If it finds
     none (or more than one) it asks "Repeater address:"; type the repeater's
     address, for example `192.168.1.50`.
   - It tries the usual login, `lutron` / `integration`. If the repeater
     accepts it, you are not asked anything more.
   - If not, it asks "Lutron integration login:" and "password:" (what you type
     for the password is not shown). Three tries. If all three are refused it
     prints this and stops:

     ```
     The repeater has no integration login we know. Whoever holds the church's RadioRA 2 project adds one under Settings > Integration and transfers it; then run this again.
     ```

     That is the one place it can stop. Pass that sentence to whoever holds the
     church's RadioRA 2 project; once they have added the login, run the
     program again.
   - If a light's name does not match any in the repeater, it lists the three
     nearest and you type 1, 2, 3, or `skip`.
4. It then prints one or more lines such as `Open this on the iPad:
   http://192.168.1.20:8777` and says "Keep this window open". On a Mac or a
   Windows PC the page also opens in the PC's own browser. Later runs skip the
   questions.
5. On the iPad, open Safari and type the address from step 4. To make it an
   icon: tap the Share button, then Add to Home Screen, name it `Sunday
   lights`, and tap Add.
6. Tap "Set Sunday lights". A few seconds later the page lists every light with
   the level asked for and the level the repeater reports, a tick or a cross,
   and the time it finished. 27 ticks means all is as it should be.
7. The PC has to stay on, awake, on the church network, with the program's
   window open, for as long as the iPad's button is to be used. Close the
   window (or press Ctrl+C) to stop it.
8. To change the address or login later, tap Setup on the page (the password
   box starts empty: leave it empty to keep the saved one), or run the program
   again with `--setup`.

The settings (address, login and password) are kept in one file that only your
own account can read:

- Mac: `~/Library/Application Support/sunday-lights/config.json`
- Windows: `%AppData%\sunday-lights\config.json`

To forget everything, delete that `sunday-lights` folder, and the next run asks
again.

## Running it from source

```
cd tools/sunday-lights
go run ./cmd/sunday-lights
```

It takes no arguments. For tests and tinkering: `--config <path>` (another
config file), `--port <n>` (not 8777), `--address <repeater>` (skip finding it),
`--setup` (ask the setup questions again).

## Building

```
cd tools/sunday-lights
make test
make build
```

`make build` writes `dist/sunday-lights-mac-apple-silicon`,
`dist/sunday-lights-mac-intel` and `dist/sunday-lights-windows.exe`. The GitHub
Actions workflow `.github/workflows/sunday-lights.yml` does the same on every
push to `main` that touches this folder, and puts the three files on the one
release `sunday-lights-latest`, replacing the last ones.

## Packages

- `lip` — the Lutron Integration Protocol over Telnet (`Dial`, `SetOutput`,
  `GetOutput`), the repeater's `DbXmlInfo.xml` (`FetchOutputs`), and a scan of
  the PC's own /24 networks for repeaters (`Discover`).
- `scene` — the 27 Sunday light levels (`levels.json`, embedded; `ParseLevel`)
  and `Match`, which finds each light's output by name.
- `config` — the repeater's address, login and password and the choices made at
  setup, kept at `config.Path()` with the file mode 0600 in a 0700 folder.
  Printing a `Config` never shows the password.
- `setup` — the first run at the terminal: find the repeater, try the usual
  login then ask for one, match the names, save the config (`Run`).
- `server` — the page on port 8777 (`page.html`, `New`, `Handler`) and
  `RunScene`, which sets the lights, reads each back and reports.
- `cmd/sunday-lights` — the program itself.
- `internal/fakelip` — a fake repeater (Telnet and `DbXmlInfo.xml`) for the
  tests of `setup`, `server` and the program.

## Tests

```
cd tools/sunday-lights
go vet ./... && go test ./...
```

No test reaches a real repeater or the real network: `lip/fake_test.go` and
`internal/fakelip` are fake repeaters listening on 127.0.0.1, and discovery runs
against a fake dialer. The setup, the page and the program were proven against
those fakes only; the first run against the real repeater is still to come.
`scene/levels_test.go` reads `src/services/routineSeeds.ts` from the repo root
and fails if `levels.json` drifts from the "House light levels" step.

Config location: `os.UserConfigDir()` + `sunday-lights/config.json`
(`~/.config` on Linux, `~/Library/Application Support` on macOS, `%AppData%` on
Windows).
