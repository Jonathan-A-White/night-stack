# sunday-lights

A small Go program for the booth PC that sets the church's house lights to the
Sunday levels on a Lutron RadioRA 2 Main Repeater. This directory holds the
core library; the program that uses it (setup at the terminal, the page the
iPad opens) comes in later stories. Standard library only, Go 1.22 or later.

## Packages

- `lip` — the Lutron Integration Protocol over Telnet (`Dial`, `SetOutput`,
  `GetOutput`), the repeater's `DbXmlInfo.xml` (`FetchOutputs`), and a scan of
  the PC's own /24 networks for repeaters (`Discover`).
- `scene` — the 27 Sunday light levels (`levels.json`, embedded; `ParseLevel`)
  and `Match`, which finds each light's output by name.
- `config` — the repeater's address, login and password and the choices made at
  setup, kept at `config.Path()` with the file mode 0600 in a 0700 folder.
  Printing a `Config` never shows the password.

## Tests

    cd tools/sunday-lights
    go vet ./... && go test ./...

No test reaches a real repeater or the real network: `lip/fake_test.go` is a
fake repeater listening on 127.0.0.1, and discovery runs against a fake dialer.
`scene/levels_test.go` reads `src/services/routineSeeds.ts` from the repo root
and fails if `levels.json` drifts from the "House light levels" step.

Config location: `os.UserConfigDir()` + `sunday-lights/config.json`
(`~/.config` on Linux, `~/Library/Application Support` on macOS, `%AppData%` on
Windows).
