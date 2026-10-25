//go:build !windows

package setup

import (
	"os"
	"os/exec"
)

// hideEcho turns the terminal's echo off with stty and returns what turns it
// back on. stty is on every Mac and Linux.
func hideEcho(f *os.File) (func(), error) {
	stty := func(arg string) error {
		cmd := exec.Command("stty", arg)
		cmd.Stdin = f
		return cmd.Run()
	}
	if err := stty("-echo"); err != nil {
		return nil, err
	}
	return func() { stty("echo") }, nil
}
