package setup

import "os"

// IsTerminal reports whether f is a terminal (or console) rather than a pipe
// or a file.
func IsTerminal(f *os.File) bool {
	st, err := f.Stat()
	return err == nil && st.Mode()&os.ModeCharDevice != 0
}

// TerminalHider returns a Deps.HideInput for f when f is a terminal, and nil
// when it is not. If the terminal's echo cannot be changed, the password is
// read with the echo on rather than not at all.
func TerminalHider(f *os.File) func() func() {
	if !IsTerminal(f) {
		return nil
	}
	return func() func() {
		restore, err := hideEcho(f)
		if err != nil {
			return func() {}
		}
		return restore
	}
}
