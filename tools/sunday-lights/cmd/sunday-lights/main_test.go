package main

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/config"
	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/internal/fakelip"
	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/lip"
	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/scene"
)

type syncBuf struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuf) Write(p []byte) (int, error) { s.mu.Lock(); defer s.mu.Unlock(); return s.b.Write(p) }
func (s *syncBuf) String() string              { s.mu.Lock(); defer s.mu.Unlock(); return s.b.String() }

func sundayOutputs() []lip.Output {
	var outs []lip.Output
	for i, l := range scene.Default() {
		outs = append(outs, lip.Output{IntegrationID: 101 + i, Name: l.Name})
	}
	return outs
}

type rigEnv struct {
	env
	out, errs *syncBuf
	rig       *fakelip.Rig
	opened    chan string
	url       chan string
}

func newRigEnv(t *testing.T, login, password, stdin string) *rigEnv {
	t.Helper()
	rig := fakelip.NewRig(t, login, password, sundayOutputs())
	r := &rigEnv{out: &syncBuf{}, errs: &syncBuf{}, rig: rig, opened: make(chan string, 1), url: make(chan string, 1)}
	r.env = env{
		stdin:       strings.NewReader(stdin),
		stdout:      r.out,
		stderr:      r.errs,
		discover:    func(ctx context.Context) ([]string, error) { return []string{fakelip.Address}, nil },
		fetch:       rig.Fetch,
		dial:        rig.Dial,
		lanIPs:      func() []string { return []string{"192.0.2.7", "10.1.1.5"} },
		openBrowser: func(u string) { r.opened <- u },
		ready:       func(u string) { r.url <- u },
	}
	return r
}

// start runs the program and returns a function that stops it and gives its
// exit code.
func (r *rigEnv) start(t *testing.T, args ...string) (stop func() int) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	code := make(chan int, 1)
	go func() { code <- run(ctx, args, r.env) }()
	t.Cleanup(cancel)
	return func() int {
		cancel()
		select {
		case c := <-code:
			return c
		case <-time.After(10 * time.Second):
			t.Fatal("run did not stop")
			return -1
		}
	}
}

func (r *rigEnv) waitURL(t *testing.T) string {
	t.Helper()
	select {
	case u := <-r.url:
		return u
	case <-time.After(10 * time.Second):
		t.Fatalf("the page never came up\nstdout:\n%s\nstderr:\n%s", r.out.String(), r.errs.String())
		return ""
	}
}

func TestFirstRunSetsUpThenServes(t *testing.T) {
	r := newRigEnv(t, "lutron", "integration", "")
	cfgPath := filepath.Join(t.TempDir(), "sl", "config.json")
	stop := r.start(t, "--config", cfgPath, "--port", "0")
	u := r.waitURL(t)

	resp, err := http.Get(u + "/")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if !strings.Contains(string(body), "Set Sunday lights") {
		t.Errorf("page: %s", body)
	}
	out := r.out.String()
	for _, want := range []string{"Open this on the iPad: http://192.0.2.7:", "Open this on the iPad: http://10.1.1.5:", "Keep this window open", cfgPath} {
		if !strings.Contains(out, want) {
			t.Errorf("stdout lacks %q:\n%s", want, out)
		}
	}
	select {
	case o := <-r.opened:
		if !strings.HasPrefix(o, "http://127.0.0.1:") {
			t.Errorf("browser opened at %q", o)
		}
	case <-time.After(5 * time.Second):
		t.Errorf("the browser was not opened")
	}
	c, err := config.LoadFrom(cfgPath)
	if err != nil || c.Login != "lutron" || c.Address != fakelip.Address {
		t.Errorf("saved config: %v, %v", c, err)
	}
	if runtime.GOOS != "windows" {
		if st, err := os.Stat(cfgPath); err != nil || st.Mode().Perm() != 0o600 {
			t.Errorf("config file mode: %v, %v", st, err)
		}
	}
	if code := stop(); code != 0 {
		t.Errorf("exit code %d", code)
	}
}

func TestLaterRunSkipsSetup(t *testing.T) {
	r := newRigEnv(t, "church", "pw-for-test", "")
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	cfg := config.Config{Address: fakelip.Address, Login: "church", Password: "pw-for-test"}
	if err := cfg.SaveTo(cfgPath); err != nil {
		t.Fatal(err)
	}
	r.discover = func(ctx context.Context) ([]string, error) { t.Error("discovery ran"); return nil, nil }
	stop := r.start(t, "--config", cfgPath, "--port", "0")
	u := r.waitURL(t)
	resp, err := http.Post(u+"/run", "application/x-www-form-urlencoded", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if l, ok := r.rig.Level(101); !ok || l != "35" {
		t.Errorf("output 101 = %q, %v", l, ok)
	}
	if strings.Contains(r.out.String(), "first-time setup") {
		t.Errorf("setup ran:\n%s", r.out.String())
	}
	if strings.Contains(r.out.String()+r.errs.String(), "pw-for-test") {
		t.Errorf("the password is in the output")
	}
	stop()
}

func TestSetupFlagAsksAgain(t *testing.T) {
	r := newRigEnv(t, "lutron", "integration", "")
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	(config.Config{Address: fakelip.Address, Login: "x", Password: "y"}).SaveTo(cfgPath)
	stop := r.start(t, "--config", cfgPath, "--port", "0", "--setup", "--address", fakelip.Address)
	r.waitURL(t)
	if !strings.Contains(r.out.String(), "first-time setup") {
		t.Errorf("--setup did not run setup:\n%s", r.out.String())
	}
	c, _ := config.LoadFrom(cfgPath)
	if c.Login != "lutron" {
		t.Errorf("config not redone: %v", c)
	}
	stop()
}

func TestNoIntegrationLoginExitsTwo(t *testing.T) {
	r := newRigEnv(t, "church", "pw-for-test", "a\nb\nc\nd\ne\nf\n")
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	code := run(context.Background(), []string{"--config", cfgPath, "--port", "0"}, r.env)
	if code != 2 {
		t.Errorf("exit code %d, want 2", code)
	}
	if !strings.Contains(r.out.String(), "The repeater has no integration login we know.") {
		t.Errorf("stdout:\n%s", r.out.String())
	}
	if _, err := os.Stat(cfgPath); err == nil {
		t.Errorf("a config was written")
	}
}

func TestArgumentsAreRefused(t *testing.T) {
	r := newRigEnv(t, "lutron", "integration", "")
	if code := run(context.Background(), []string{"hello"}, r.env); code != 1 {
		t.Errorf("exit code %d, want 1", code)
	}
}
