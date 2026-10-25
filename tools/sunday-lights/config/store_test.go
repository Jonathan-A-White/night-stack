package config

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// useTempConfigDir points os.UserConfigDir at a fresh temp directory.
func useTempConfigDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	switch runtime.GOOS {
	case "windows":
		t.Setenv("AppData", dir)
	case "darwin":
		t.Setenv("HOME", dir)
	default:
		t.Setenv("XDG_CONFIG_HOME", dir)
	}
	return dir
}

func sample() Config {
	return Config{
		Address:        "192.168.1.50",
		Login:          "lutron",
		Password:       "s3cret-pass",
		Picks:          map[string]int{"Chandelier": 17},
		LevelOverrides: map[string]string{"Chandelier": "50%"},
	}
}

func TestRoundTrip(t *testing.T) {
	useTempConfigDir(t)
	p, err := Path()
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(p) != "config.json" || filepath.Base(filepath.Dir(p)) != "sunday-lights" {
		t.Fatalf("Path() = %q", p)
	}
	if err := sample().Save(); err != nil {
		t.Fatalf("Save: %v", err)
	}
	got, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	want := sample()
	if got.Address != want.Address || got.Login != want.Login || got.Password != want.Password ||
		got.Picks["Chandelier"] != 17 || got.LevelOverrides["Chandelier"] != "50%" {
		t.Fatalf("round trip: %#v", got)
	}
	// Saving again over an existing file works.
	want.Address = "10.0.0.2"
	if err := want.Save(); err != nil {
		t.Fatal(err)
	}
	if got, _ := Load(); got.Address != "10.0.0.2" {
		t.Fatalf("second save lost: %v", got.Address)
	}
}

func TestLoadMissingFile(t *testing.T) {
	useTempConfigDir(t)
	c, err := Load()
	if !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("err = %v, want one that is fs.ErrNotExist", err)
	}
	if c.Picks == nil || c.LevelOverrides == nil {
		t.Fatal("maps should be non-nil so callers can write to them")
	}
}

func TestLoadCorruptFile(t *testing.T) {
	useTempConfigDir(t)
	p, _ := Path()
	os.MkdirAll(filepath.Dir(p), 0o700)
	os.WriteFile(p, []byte("{not json"), 0o600)
	_, err := Load()
	if err == nil || errors.Is(err, fs.ErrNotExist) || !strings.Contains(err.Error(), p) {
		t.Fatalf("err = %v", err)
	}
}

func TestModes(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows modes are the ACL CreateFile gives")
	}
	useTempConfigDir(t)
	if err := sample().Save(); err != nil {
		t.Fatal(err)
	}
	p, _ := Path()
	fi, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode().Perm() != 0o600 {
		t.Fatalf("file mode %v, want 0600", fi.Mode().Perm())
	}
	di, _ := os.Stat(filepath.Dir(p))
	if di.Mode().Perm() != 0o700 {
		t.Fatalf("dir mode %v, want 0700", di.Mode().Perm())
	}
	// A file left looser by hand is tightened on the next save.
	os.Chmod(p, 0o644)
	if err := sample().Save(); err != nil {
		t.Fatal(err)
	}
	fi, _ = os.Stat(p)
	if fi.Mode().Perm() != 0o600 {
		t.Fatalf("file mode after resave %v, want 0600", fi.Mode().Perm())
	}
}

func TestStringNeverShowsPassword(t *testing.T) {
	c := sample()
	pc := &c
	outs := []string{
		c.String(), pc.String(),
		fmt.Sprint(c), fmt.Sprint(pc),
		fmt.Sprintf("%v %+v %#v %s", c, c, c, c),
		fmt.Sprintf("%v %+v %#v %s", pc, pc, pc, pc),
	}
	for _, o := range outs {
		if strings.Contains(o, "s3cret-pass") {
			t.Fatalf("password in %q", o)
		}
	}
	if !strings.Contains(c.String(), "192.168.1.50") {
		t.Fatalf("String() should still show the address: %q", c.String())
	}
}

func TestNoModuleSourceLogsAPassword(t *testing.T) {
	// A cheap guard: no non-test Go file in the module prints or logs a
	// field called Password.
	err := filepath.WalkDir("..", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(p, ".go") || strings.HasSuffix(p, "_test.go") {
			return err
		}
		b, _ := os.ReadFile(p)
		for i, line := range strings.Split(string(b), "\n") {
			l := strings.ToLower(line)
			if strings.Contains(l, "password") && (strings.Contains(l, "log.") || strings.Contains(l, "fmt.print") || strings.Contains(l, "fmt.fprint") || strings.Contains(l, "slog.")) {
				t.Errorf("%s:%d prints a password: %s", p, i+1, strings.TrimSpace(line))
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
