// Package setup is the first run at the terminal: find the repeater, get a
// login it accepts, match the 27 light names to its outputs and save the
// config.
package setup

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/config"
	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/lip"
	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/scene"
)

// The login Lutron repeaters ship with.
const (
	DefaultLogin  = "lutron"
	DefaultSecret = "integration"
)

// What the person is asked at the terminal.
const (
	loginPrompt  = "Lutron integration login: "
	secretPrompt = "password: "
)

// NoLoginSentence is printed when the repeater refuses every login asked for.
const NoLoginSentence = "The repeater has no integration login we know. Whoever holds the church's RadioRA 2 project adds one under Settings > Integration and transfers it; then run this again."

// AskedLogins is how many logins and passwords the person is asked for.
const AskedLogins = 3

// ErrNoLogin means the repeater refused the usual login and every one asked
// for; the program exits with code 2.
var ErrNoLogin = errors.New(NoLoginSentence)

// ExitCode is the process exit code for an error from Run: 2 for ErrNoLogin,
// 1 for any other, 0 for none.
func ExitCode(err error) int {
	switch {
	case err == nil:
		return 0
	case errors.Is(err, ErrNoLogin):
		return 2
	}
	return 1
}

// Deps is what Run reaches out to; tests hand it fakes.
type Deps struct {
	// Address, when set, is the repeater to use and nothing is discovered.
	Address string
	// Existing is the config so far; its picks and level overrides are kept.
	Existing config.Config
	Lights   []scene.Light

	Discover func(ctx context.Context) ([]string, error)
	Fetch    func(ctx context.Context, address string) ([]lip.Output, error)
	Dial     func(ctx context.Context, address, login, password string) (*lip.Client, error)
	Save     func(config.Config) error
	Path     string // where Save writes, to tell the person

	// HideInput, when the input is a terminal, turns its echo off and returns
	// what turns it back on. Nil reads the password as plain text.
	HideInput func() (restore func())
}

// Run does the setup, talking to the person through in and out, and returns
// the config it saved. The password is never written to out.
func Run(ctx context.Context, in io.Reader, out io.Writer, deps Deps) (config.Config, error) {
	rd := bufio.NewReader(in)
	cfg := deps.Existing
	if cfg.Picks == nil {
		cfg.Picks = map[string]int{}
	}
	if cfg.LevelOverrides == nil {
		cfg.LevelOverrides = map[string]string{}
	}

	address, err := findAddress(ctx, rd, out, deps)
	if err != nil {
		return cfg, err
	}
	cfg.Address = address

	fmt.Fprintf(out, "Reading the lights from the repeater at %s ...\n", address)
	outputs, err := deps.Fetch(ctx, address)
	if err != nil {
		return cfg, fmt.Errorf("could not read the repeater's list of lights: %w", err)
	}

	login, password, err := getLogin(ctx, rd, out, deps, address)
	if err != nil {
		return cfg, err
	}
	cfg.Login, cfg.Password = login, password

	lights := scene.WithOverrides(deps.Lights, cfg.LevelOverrides)
	results := scene.Match(lights, outputs, cfg.Picks)
	for i, r := range results {
		if r.Matched {
			continue
		}
		id, ok, err := pickOutput(rd, out, r)
		if err != nil {
			return cfg, err
		}
		if ok {
			cfg.Picks[r.Light.Name] = id
			results[i].Matched, results[i].OutputID, results[i].How = true, id, "pick"
		}
	}

	if err := deps.Save(cfg); err != nil {
		return cfg, fmt.Errorf("could not save the settings: %w", err)
	}
	matched := 0
	for _, r := range results {
		if r.Matched {
			matched++
		}
	}
	fmt.Fprintf(out, "%d of %d lights matched.\n", matched, len(results))
	fmt.Fprintf(out, "Settings saved to %s\n", deps.Path)
	return cfg, nil
}

func findAddress(ctx context.Context, rd *bufio.Reader, out io.Writer, deps Deps) (string, error) {
	if deps.Address != "" {
		return deps.Address, nil
	}
	fmt.Fprintln(out, "Looking for the repeater on this network (this takes up to half a minute) ...")
	found, err := deps.Discover(ctx)
	if err != nil && ctx.Err() != nil {
		return "", ctx.Err()
	}
	switch len(found) {
	case 1:
		fmt.Fprintf(out, "Found the repeater at %s\n", found[0])
		return found[0], nil
	case 0:
		fmt.Fprintln(out, "No repeater was found.")
	default:
		fmt.Fprintln(out, "More than one repeater was found:")
		for _, f := range found {
			fmt.Fprintf(out, "  %s\n", f)
		}
	}
	fmt.Fprint(out, "Repeater address: ")
	line, err := readLine(rd)
	if err != nil {
		return "", fmt.Errorf("no repeater address given: %w", err)
	}
	if line == "" {
		return "", errors.New("no repeater address given")
	}
	return line, nil
}

// getLogin tries lutron / integration, then asks for a login up to
// AskedLogins times. It returns ErrNoLogin after the last refusal.
func getLogin(ctx context.Context, rd *bufio.Reader, out io.Writer, deps Deps, address string) (string, string, error) {
	try := func(login, password string) (bool, error) {
		c, err := deps.Dial(ctx, address, login, password)
		if err == nil {
			c.Close()
			return true, nil
		}
		if errors.Is(err, lip.ErrBadLogin) {
			return false, nil
		}
		return false, fmt.Errorf("could not log in to the repeater: %w", err)
	}

	fmt.Fprintf(out, "Trying the usual login (%s / %s) ...\n", DefaultLogin, DefaultSecret)
	if ok, err := try(DefaultLogin, DefaultSecret); err != nil || ok {
		return DefaultLogin, DefaultSecret, err
	}
	fmt.Fprintln(out, "The repeater did not accept it.")

	for attempt := 1; attempt <= AskedLogins; attempt++ {
		fmt.Fprint(out, loginPrompt)
		login, err := readLine(rd)
		if err != nil {
			return "", "", fmt.Errorf("no login given: %w", err)
		}
		fmt.Fprint(out, secretPrompt)
		var restore func()
		if deps.HideInput != nil {
			restore = deps.HideInput()
		}
		password, err := readLine(rd)
		if restore != nil {
			restore()
			fmt.Fprintln(out)
		}
		if err != nil {
			return "", "", fmt.Errorf("no password given: %w", err)
		}
		if ok, err := try(login, password); err != nil || ok {
			return login, password, err
		}
		if attempt < AskedLogins {
			fmt.Fprintln(out, "The repeater did not accept that. Try again.")
		}
	}
	fmt.Fprintln(out, NoLoginSentence)
	return "", "", ErrNoLogin
}

// pickOutput shows the three nearest outputs for a light that did not match
// by name and takes a number or "skip".
func pickOutput(rd *bufio.Reader, out io.Writer, r scene.Result) (int, bool, error) {
	sug := r.Suggestions
	if len(sug) > 3 {
		sug = sug[:3]
	}
	if len(sug) == 0 {
		fmt.Fprintf(out, "\nNo output is named \"%s\", and the repeater has none to suggest. Skipping it.\n", r.Light.Name)
		return 0, false, nil
	}
	fmt.Fprintf(out, "\nNo output is named \"%s\". The nearest are:\n", r.Light.Name)
	for i, o := range sug {
		area := ""
		if o.Area != "" {
			area = " in " + o.Area
		}
		fmt.Fprintf(out, "  %d) %s%s [%d]\n", i+1, o.Name, area, o.IntegrationID)
	}
	for {
		fmt.Fprintf(out, "Which one is \"%s\"? Type 1-%d, or skip: ", r.Light.Name, len(sug))
		line, err := readLine(rd)
		if err != nil {
			if errors.Is(err, io.EOF) {
				fmt.Fprintln(out, "(no answer; skipping)")
				return 0, false, nil
			}
			return 0, false, err
		}
		if strings.EqualFold(line, "skip") {
			return 0, false, nil
		}
		if n, err := strconv.Atoi(line); err == nil && n >= 1 && n <= len(sug) {
			return sug[n-1].IntegrationID, true, nil
		}
	}
}

// readLine reads one line without its line ending. A last line with no
// ending is returned; end of input with nothing read is io.EOF.
func readLine(rd *bufio.Reader) (string, error) {
	s, err := rd.ReadString('\n')
	if err != nil && (!errors.Is(err, io.EOF) || s == "") {
		return "", err
	}
	return strings.TrimRight(s, "\r\n"), nil
}
