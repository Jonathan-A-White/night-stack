# Sunday lights

`tools/sunday-lights` is a separate Go program for the booth PC, not part of the
Night Stack app. It sets the church's 27 Lutron house lights to the Sunday
levels (the same ones as the "House light levels" step in the Sunday routine)
by talking to the RadioRA 2 Main Repeater on the church network, so the lights
need not be set by hand from the Cased iPad.

Nothing in the app changes: the routine step keeps its text, and the Go tree is
outside the app's build, lint and tests. The tool reads that step's text only in
a test, to make sure its own list of levels matches.

See [tools/sunday-lights/README.md](../tools/sunday-lights/README.md) for the
steps on a Sunday morning (which file to download, how to run it, the iPad), the
packages, and how to run its tests. The program asks its setup questions at the
terminal on the first run, then serves a page on port 8777 with one button,
"Set Sunday lights", that reads each light back. A GitHub Actions workflow
(`.github/workflows/sunday-lights.yml`) builds it for macOS (Apple silicon and
Intel) and Windows and puts the three files on the release
[sunday-lights-latest](https://github.com/Jonathan-A-White/night-stack/releases/tag/sunday-lights-latest).
Everything was proven against fakes only; no real repeater has been reached yet.
