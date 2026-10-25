// Package config keeps the repeater's address and login, and the choices
// made at setup, in one file on the PC and nowhere else.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Config is everything setup learns. The password is the repeater's Telnet
// password; it lives only in this file.
type Config struct {
	Address        string            `json:"address"`
	Login          string            `json:"login"`
	Password       string            `json:"password"`
	Picks          map[string]int    `json:"picks"`          // light name -> integration ID chosen at setup
	LevelOverrides map[string]string `json:"levelOverrides"` // light name -> "Off", "On" or "N%"
}

// String describes the config without the password, so that printing it or
// logging it with %v, %+v or %s cannot leak the password.
func (c Config) String() string {
	pw := "(none)"
	if c.Password != "" {
		pw = "(set, hidden)"
	}
	picks := make([]string, 0, len(c.Picks))
	for name, id := range c.Picks {
		picks = append(picks, fmt.Sprintf("%s=%d", name, id))
	}
	sort.Strings(picks)
	return fmt.Sprintf("config{address: %q, login: %q, password: %s, picks: [%s], level overrides: %d}",
		c.Address, c.Login, pw, strings.Join(picks, ", "), len(c.LevelOverrides))
}

// GoString is what %#v prints; it is String as well.
func (c Config) GoString() string { return c.String() }

// Path is where the config file lives: <user config dir>/sunday-lights/config.json.
func Path() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("config: no user config directory: %w", err)
	}
	return filepath.Join(dir, "sunday-lights", "config.json"), nil
}

// Load reads the config file. When there is none yet the error satisfies
// errors.Is(err, fs.ErrNotExist) and the Config returned is empty. Maps are
// never nil.
func Load() (Config, error) {
	c := Config{Picks: map[string]int{}, LevelOverrides: map[string]string{}}
	p, err := Path()
	if err != nil {
		return c, err
	}
	b, err := os.ReadFile(p)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return c, fmt.Errorf("config: no config file yet at %s: %w", p, err)
		}
		return c, fmt.Errorf("config: reading %s: %w", p, err)
	}
	if err := json.Unmarshal(b, &c); err != nil {
		return Config{Picks: map[string]int{}, LevelOverrides: map[string]string{}},
			fmt.Errorf("config: %s is not valid JSON: %w", p, err)
	}
	if c.Picks == nil {
		c.Picks = map[string]int{}
	}
	if c.LevelOverrides == nil {
		c.LevelOverrides = map[string]string{}
	}
	return c, nil
}

// Save writes the config file, creating its folder with mode 0700 and the
// file with mode 0600. It writes a temporary file in the same folder and
// renames it over the old one, so a crash leaves the old file whole.
//
// On Windows the modes mean little: the folder and file get whatever access
// control Windows gives a new file in the user's own AppData, which is the
// user's account (and administrators) only.
func (c Config) Save() error {
	p, err := Path()
	if err != nil {
		return err
	}
	dir := filepath.Dir(p)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("config: creating %s: %w", dir, err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return fmt.Errorf("config: securing %s: %w", dir, err)
	}
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, "config-*.tmp") // created 0600
	if err != nil {
		return fmt.Errorf("config: writing in %s: %w", dir, err)
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return fmt.Errorf("config: securing the new file: %w", err)
	}
	if _, err := tmp.Write(append(b, '\n')); err != nil {
		tmp.Close()
		return fmt.Errorf("config: writing %s: %w", p, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("config: writing %s: %w", p, err)
	}
	if err := os.Rename(tmp.Name(), p); err != nil {
		return fmt.Errorf("config: replacing %s: %w", p, err)
	}
	return nil
}
