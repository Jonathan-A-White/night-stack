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
packages and how to run its tests. This first piece is the library (repeater
client, output list, discovery, level list and name matching, config store); it
was proven against fakes only.
