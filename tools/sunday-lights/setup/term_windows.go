//go:build windows

package setup

import (
	"os"
	"syscall"
	"unsafe"
)

const enableEchoInput = 0x0004

var (
	kernel32       = syscall.NewLazyDLL("kernel32.dll")
	getConsoleMode = kernel32.NewProc("GetConsoleMode")
	setConsoleMode = kernel32.NewProc("SetConsoleMode")
)

// hideEcho turns the console's input echo off and returns what restores it.
func hideEcho(f *os.File) (func(), error) {
	h := f.Fd()
	var mode uint32
	if r, _, err := getConsoleMode.Call(h, uintptr(unsafe.Pointer(&mode))); r == 0 {
		return nil, err
	}
	if r, _, err := setConsoleMode.Call(h, uintptr(mode&^enableEchoInput)); r == 0 {
		return nil, err
	}
	return func() { setConsoleMode.Call(h, uintptr(mode)) }, nil
}
