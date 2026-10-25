package setup

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/config"
	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/internal/fakelip"
	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/lip"
	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/scene"
)

const noLoginSentence = "The repeater has no integration login we know. Whoever holds the church's RadioRA 2 project adds one under Settings > Integration and transfers it; then run this again."

// outputsFor names an output after each Sunday light, ids from 101, except
// that the lights named in renamed get another name.
func outputsFor(renamed map[string]string) []lip.Output {
	var outs []lip.Output
	for i, l := range scene.Default() {
		name := l.Name
		if n, ok := renamed[name]; ok {
			name = n
		}
		outs = append(outs, lip.Output{IntegrationID: 101 + i, Name: name})
	}
	return outs
}

type harness struct {
	rig   *fakelip.Rig
	deps  Deps
	saved *config.Config
	out   bytes.Buffer
}

func newHarness(t *testing.T, login, password string, outs []lip.Output) *harness {
	t.Helper()
	h := &harness{rig: fakelip.NewRig(t, login, password, outs)}
	h.deps = Deps{
		Discover: func(ctx context.Context) ([]string, error) { return []string{fakelip.Address}, nil },
		Fetch:    h.rig.Fetch,
		Dial:     h.rig.Dial,
		Lights:   scene.Default(),
		Path:     "/fake/config.json",
		Save:     func(c config.Config) error { h.saved = &c; return nil },
	}
	return h
}

func (h *harness) run(t *testing.T, input string) (config.Config, error) {
	t.Helper()
	return Run(context.Background(), strings.NewReader(input), &h.out, h.deps)
}

func TestRunDefaultLoginPath(t *testing.T) {
	h := newHarness(t, "lutron", "integration", outputsFor(nil))
	cfg, err := h.run(t, "")
	if err != nil {
		t.Fatalf("Run: %v\n%s", err, h.out.String())
	}
	if cfg.Address != fakelip.Address || cfg.Login != "lutron" || cfg.Password != "integration" {
		t.Fatalf("config %v", cfg)
	}
	if h.saved == nil || h.saved.Login != "lutron" {
		t.Fatalf("config not saved: %v", h.saved)
	}
	out := h.out.String()
	for _, want := range []string{"lutron / integration", "27 of 27", "/fake/config.json"} {
		if !strings.Contains(out, want) {
			t.Errorf("output lacks %q:\n%s", want, out)
		}
	}
	if strings.Contains(out, "Lutron integration login:") {
		t.Errorf("asked for a login on the default path:\n%s", out)
	}
	if got := h.rig.LoginAttempts(); len(got) != 1 || got[0] != "lutron/integration" {
		t.Errorf("login attempts %v", got)
	}
}

func TestRunAskedLoginPath(t *testing.T) {
	h := newHarness(t, "church", "s3cretword", outputsFor(nil))
	cfg, err := h.run(t, "wrong\nnope\nchurch\ns3cretword\n")
	if err != nil {
		t.Fatalf("Run: %v\n%s", err, h.out.String())
	}
	if cfg.Login != "church" || cfg.Password != "s3cretword" {
		t.Fatalf("config %v", cfg)
	}
	out := h.out.String()
	if n := strings.Count(out, "Lutron integration login:"); n != 2 {
		t.Errorf("asked for the login %d times, want 2:\n%s", n, out)
	}
	if n := strings.Count(out, "password:"); n != 2 {
		t.Errorf("asked for the password %d times, want 2", n)
	}
	if strings.Contains(out, "s3cretword") || strings.Contains(out, "nope") {
		t.Errorf("a password is in the output:\n%s", out)
	}
}

func TestRunHidesInputWhileTheTerminalAsksForAPassword(t *testing.T) {
	h := newHarness(t, "church", "s3cretword", outputsFor(nil))
	hidden, restored := 0, 0
	h.deps.HideInput = func() func() { hidden++; return func() { restored++ } }
	if _, err := h.run(t, "church\ns3cretword\n"); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if hidden != 1 || restored != 1 {
		t.Errorf("hid input %d times and restored %d times, want 1 and 1", hidden, restored)
	}
}

func TestRunThirdRefusalStops(t *testing.T) {
	h := newHarness(t, "church", "s3cretword", outputsFor(nil))
	_, err := h.run(t, "a\nb\nc\nd\ne\nf\n")
	if !errors.Is(err, ErrNoLogin) {
		t.Fatalf("err = %v, want ErrNoLogin", err)
	}
	out := h.out.String()
	if !strings.Contains(out, noLoginSentence) {
		t.Errorf("the sentence is not in the output:\n%s", out)
	}
	if n := strings.Count(out, "Lutron integration login:"); n != 3 {
		t.Errorf("asked %d times, want 3", n)
	}
	if h.saved != nil {
		t.Errorf("a config was saved after the refusals: %v", h.saved)
	}
	if ExitCode(err) != 2 {
		t.Errorf("ExitCode = %d, want 2", ExitCode(err))
	}
}

func TestRunOneUnmatchedLightPicked(t *testing.T) {
	outs := outputsFor(map[string]string{"Recess back": "Back recess cans"})
	h := newHarness(t, "lutron", "integration", outs)
	cfg, err := h.run(t, "1\n")
	if err != nil {
		t.Fatalf("Run: %v\n%s", err, h.out.String())
	}
	out := h.out.String()
	if !strings.Contains(out, "Recess back") || !strings.Contains(out, "1) ") || !strings.Contains(out, "3) ") {
		t.Errorf("no numbered list of three for the unmatched light:\n%s", out)
	}
	if strings.Contains(out, "4) ") {
		t.Errorf("more than three suggestions:\n%s", out)
	}
	id, ok := cfg.Picks["Recess back"]
	if !ok {
		t.Fatalf("no pick saved: %v", cfg)
	}
	if id == 0 || !strings.Contains(out, fmt.Sprintf("[%d]", id)) {
		t.Errorf("picked %d, which is not one of the listed outputs\n%s", id, out)
	}
	if !strings.Contains(out, "27 of 27") {
		t.Errorf("not all matched after the pick:\n%s", out)
	}
}

func TestRunUnmatchedLightSkipped(t *testing.T) {
	h := newHarness(t, "lutron", "integration", outputsFor(map[string]string{"Recess back": "Back recess cans"}))
	cfg, err := h.run(t, "bogus\nskip\n")
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if _, ok := cfg.Picks["Recess back"]; ok {
		t.Errorf("a pick was saved for a skipped light: %v", cfg.Picks)
	}
	if !strings.Contains(h.out.String(), "26 of 27") {
		t.Errorf("output lacks 26 of 27:\n%s", h.out.String())
	}
}

func TestRunAsksForAddressWhenNoneFound(t *testing.T) {
	h := newHarness(t, "lutron", "integration", outputsFor(nil))
	h.deps.Discover = func(ctx context.Context) ([]string, error) { return nil, nil }
	cfg, err := h.run(t, fakelip.Address+"\n")
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if cfg.Address != fakelip.Address {
		t.Errorf("address %q", cfg.Address)
	}
	if !strings.Contains(h.out.String(), "Repeater address:") {
		t.Errorf("no address prompt:\n%s", h.out.String())
	}
}

func TestRunUsesAnAddressGiven(t *testing.T) {
	h := newHarness(t, "lutron", "integration", outputsFor(nil))
	h.deps.Address = fakelip.Address
	h.deps.Discover = func(ctx context.Context) ([]string, error) { t.Fatal("discovery ran"); return nil, nil }
	if _, err := h.run(t, ""); err != nil {
		t.Fatalf("Run: %v", err)
	}
}
