package lip

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestDialGoodLogin(t *testing.T) {
	f := newFakeRepeater(t, "lutron", "integration")
	addr := f.start()
	c, err := Dial(context.Background(), addr, "lutron", "integration")
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	defer c.Close()
}

func TestDialSurvivesTelnetNegotiationAndCapitals(t *testing.T) {
	f := newFakeRepeater(t, "lutron", "integration")
	f.iac = true
	f.upperPrompt = true
	addr := f.start()
	c, err := Dial(context.Background(), addr, "lutron", "integration")
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	defer c.Close()
}

func TestDialBadLogin(t *testing.T) {
	f := newFakeRepeater(t, "lutron", "integration")
	addr := f.start()
	_, err := Dial(context.Background(), addr, "lutron", "wrong-secret")
	if !errors.Is(err, ErrBadLogin) {
		t.Fatalf("want ErrBadLogin, got %v", err)
	}
	if strings.Contains(err.Error(), "wrong-secret") {
		t.Fatalf("error text carries the password: %q", err)
	}
}

func TestDialRefusedLoginEvenWithRightPair(t *testing.T) {
	f := newFakeRepeater(t, "lutron", "integration")
	f.refuseLogin = true
	addr := f.start()
	_, err := Dial(context.Background(), addr, "lutron", "integration")
	if !errors.Is(err, ErrBadLogin) {
		t.Fatalf("want ErrBadLogin, got %v", err)
	}
}

func TestDialSilentRepeaterTimesOut(t *testing.T) {
	f := newFakeRepeater(t, "lutron", "integration")
	f.silent = true
	addr := f.start()
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := Dial(ctx, addr, "lutron", "integration")
	if err == nil {
		t.Fatal("want an error from a silent repeater")
	}
	if errors.Is(err, ErrBadLogin) {
		t.Fatalf("a silent repeater is a timeout, not a bad login: %v", err)
	}
	if d := time.Since(start); d > 2*time.Second {
		t.Fatalf("took %v, want about the ctx deadline", d)
	}
}

func TestDialNothingListening(t *testing.T) {
	f := newFakeRepeater(t, "a", "b")
	addr := f.ln.Addr().String()
	f.ln.Close()
	if _, err := Dial(context.Background(), addr, "a", "b"); err == nil {
		t.Fatal("want a connection error")
	}
}

func TestSetThenGetOutput(t *testing.T) {
	f := newFakeRepeater(t, "lutron", "integration")
	addr := f.start()
	c, err := Dial(context.Background(), addr, "lutron", "integration")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	ctx := context.Background()

	if err := c.SetOutput(ctx, 11, 35, 2); err != nil {
		t.Fatalf("SetOutput: %v", err)
	}
	got, err := c.GetOutput(ctx, 11)
	if err != nil {
		t.Fatalf("GetOutput: %v", err)
	}
	if got != 35 {
		t.Fatalf("level = %v, want 35", got)
	}
	if err := c.SetOutput(ctx, 12, 12.5, 0.5); err != nil {
		t.Fatal(err)
	}
	if got, err := c.GetOutput(ctx, 12); err != nil || got != 12.5 {
		t.Fatalf("level = %v, %v; want 12.5", got, err)
	}
	// A level the fake never heard of reads as the fake's default, after the
	// unrelated ~DEVICE line is skipped.
	if got, err := c.GetOutput(ctx, 77); err != nil || got != 0 {
		t.Fatalf("level = %v, %v; want 0", got, err)
	}

	cmds := f.commands()
	want := []string{"#OUTPUT,11,1,35,2", "?OUTPUT,11,1", "#OUTPUT,12,1,12.5,0.5", "?OUTPUT,12,1", "?OUTPUT,77,1"}
	if strings.Join(cmds, "|") != strings.Join(want, "|") {
		t.Fatalf("commands = %q, want %q", cmds, want)
	}
}

func TestSetOutputRejectsBadLevel(t *testing.T) {
	f := newFakeRepeater(t, "lutron", "integration")
	addr := f.start()
	c, err := Dial(context.Background(), addr, "lutron", "integration")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	for _, lvl := range []float64{-1, 100.5, 1000} {
		if err := c.SetOutput(context.Background(), 1, lvl, 0); err == nil {
			t.Errorf("level %v accepted", lvl)
		}
	}
	if err := c.SetOutput(context.Background(), 1, 50, -1); err == nil {
		t.Error("negative fade accepted")
	}
	if n := len(f.commands()); n != 0 {
		t.Fatalf("%d commands reached the repeater, want none", n)
	}
}

func TestSetOutputWithoutEchoStillSucceeds(t *testing.T) {
	f := newFakeRepeater(t, "lutron", "integration")
	f.noEcho = true
	addr := f.start()
	c, err := Dial(context.Background(), addr, "lutron", "integration")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.EchoWait = 100 * time.Millisecond
	if err := c.SetOutput(context.Background(), 5, 100, 0); err != nil {
		t.Fatalf("SetOutput: %v", err)
	}
	if l, _ := f.level(5); l != "100" {
		t.Fatalf("repeater level = %q, want 100", l)
	}
}

func TestGetOutputTimesOutWhenRepeaterStaysSilent(t *testing.T) {
	f := newFakeRepeater(t, "lutron", "integration")
	f.noQuery = true
	addr := f.start()
	c, err := Dial(context.Background(), addr, "lutron", "integration")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	start := time.Now()
	if _, err := c.GetOutput(ctx, 3); err == nil {
		t.Fatal("want a timeout")
	}
	if d := time.Since(start); d > 2*time.Second {
		t.Fatalf("took %v", d)
	}
}

func TestDefaultReadDeadlineIsFiveSeconds(t *testing.T) {
	if ReadTimeout != 5*time.Second {
		t.Fatalf("ReadTimeout = %v, want 5s", ReadTimeout)
	}
}

func TestAddressDefaultsToPort23(t *testing.T) {
	cases := map[string]string{
		"192.168.1.5":      "192.168.1.5:23",
		"192.168.1.5:2323": "192.168.1.5:2323",
		"repeater.local":   "repeater.local:23",
		"[::1]":            "[::1]:23",
		"[::1]:99":         "[::1]:99",
	}
	for in, want := range cases {
		if got := withDefaultPort(in); got != want {
			t.Errorf("withDefaultPort(%q) = %q, want %q", in, got, want)
		}
	}
}
