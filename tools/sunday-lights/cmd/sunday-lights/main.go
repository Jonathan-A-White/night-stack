// Command sunday-lights sets the church's house lights to the Sunday levels.
// Run it with no arguments: the first time it asks a few questions at the
// terminal, then it serves a page on port 8777 that the iPad opens.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/config"
	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/lip"
	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/scene"
	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/server"
	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/setup"
)

// discoverTimeout bounds the scan for the repeater.
const discoverTimeout = 45 * time.Second

// env is what run reaches the outside world through; main fills it in and
// the tests replace parts of it.
type env struct {
	stdin       io.Reader
	stdout      io.Writer
	stderr      io.Writer
	hideInput   func() func() // nil unless stdin is a terminal
	discover    func(ctx context.Context) ([]string, error)
	fetch       func(ctx context.Context, address string) ([]lip.Output, error)
	dial        func(ctx context.Context, address, login, password string) (*lip.Client, error)
	lanIPs      func() []string
	openBrowser func(url string) // nil: do not open one
	ready       func(url string) // called once the page is being served, if set
}

func main() {
	e := env{
		stdin:     os.Stdin,
		stdout:    os.Stdout,
		stderr:    os.Stderr,
		hideInput: setup.TerminalHider(os.Stdin),
		discover:  discoverRepeaters,
		fetch: func(ctx context.Context, address string) ([]lip.Output, error) {
			return lip.FetchOutputs(ctx, nil, address)
		},
		dial:   lip.Dial,
		lanIPs: lanIPv4s,
	}
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		e.openBrowser = openBrowser
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	os.Exit(run(ctx, os.Args[1:], e))
}

func run(ctx context.Context, args []string, e env) int {
	fs_ := flag.NewFlagSet("sunday-lights", flag.ContinueOnError)
	fs_.SetOutput(e.stderr)
	configPath := fs_.String("config", "", "config file (default: in your user config folder)")
	port := fs_.Int("port", server.Port, "port for the page")
	address := fs_.String("address", "", "repeater address (default: find it)")
	forceSetup := fs_.Bool("setup", false, "ask the setup questions again")
	if err := fs_.Parse(args); err != nil {
		return 1
	}
	if fs_.NArg() > 0 {
		fmt.Fprintln(e.stderr, "sunday-lights takes no arguments: just run it.")
		return 1
	}

	path := *configPath
	if path == "" {
		p, err := config.Path()
		if err != nil {
			fmt.Fprintln(e.stderr, err)
			return 1
		}
		path = p
	}
	cfg, err := config.LoadFrom(path)
	needSetup := *forceSetup
	switch {
	case errors.Is(err, fs.ErrNotExist):
		needSetup = true
	case err != nil:
		fmt.Fprintf(e.stdout, "The settings file %s could not be read (%v); starting setup again.\n", path, err)
		needSetup = true
	case cfg.Address == "" || cfg.Login == "":
		needSetup = true
	}

	if needSetup {
		fmt.Fprintln(e.stdout, "Sunday lights: first-time setup.")
		cfg, err = setup.Run(ctx, e.stdin, e.stdout, setup.Deps{
			Address:   *address,
			Existing:  cfg,
			Lights:    scene.Default(),
			Discover:  e.discover,
			Fetch:     e.fetch,
			Dial:      e.dial,
			Save:      func(c config.Config) error { return c.SaveTo(path) },
			Path:      path,
			HideInput: e.hideInput,
		})
		if err != nil {
			if errors.Is(err, setup.ErrNoLogin) {
				return setup.ExitCode(err) // the sentence is already printed
			}
			fmt.Fprintf(e.stderr, "Setup stopped: %v\n", err)
			return setup.ExitCode(err)
		}
	} else if *address != "" {
		cfg.Address = *address
	}

	srv := server.New(server.Options{
		Config: cfg,
		Lights: scene.Default(),
		Fetch:  e.fetch,
		Dial:   e.dial,
		Save:   func(c config.Config) error { return c.SaveTo(path) },
		Log:    log.New(e.stderr, "", log.LstdFlags),
	})
	if err := srv.Refresh(ctx); err != nil {
		fmt.Fprintf(e.stdout, "Could not read the lights from the repeater yet (%v). The page will say so; use Setup there to fix the address.\n", err)
	}

	ln, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", *port))
	if err != nil {
		fmt.Fprintf(e.stderr, "Could not listen on port %d (is Sunday lights already running?): %v\n", *port, err)
		return 1
	}
	actual := ln.Addr().(*net.TCPAddr).Port
	ips := e.lanIPs()
	if len(ips) == 0 {
		fmt.Fprintln(e.stdout, "Open this on the iPad: (this PC has no network address; connect it to the church network first)")
	}
	for _, ip := range ips {
		fmt.Fprintf(e.stdout, "Open this on the iPad: http://%s\n", net.JoinHostPort(ip, fmt.Sprint(actual)))
	}
	fmt.Fprintln(e.stdout, "Keep this window open.")

	local := fmt.Sprintf("http://127.0.0.1:%d", actual)
	if e.openBrowser != nil {
		go e.openBrowser(local)
	}
	if e.ready != nil {
		e.ready(local)
	}
	if err := srv.Serve(ctx, ln); err != nil {
		fmt.Fprintf(e.stderr, "The page stopped: %v\n", err)
		return 1
	}
	return 0
}

// discoverRepeaters scans the PC's own networks for a repeater.
func discoverRepeaters(ctx context.Context) ([]string, error) {
	nets, err := lip.LocalNets()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, discoverTimeout)
	defer cancel()
	return lip.Discover(ctx, &net.Dialer{}, lip.HTTPFetcher(nil), nets)
}

// lanIPv4s lists the PC's non-loopback IPv4 addresses, each once.
func lanIPv4s() []string {
	nets, err := lip.LocalNets()
	if err != nil {
		return nil
	}
	seen := map[string]bool{}
	var ips []string
	for _, n := range nets {
		ip := n.IP.To4().String()
		if !seen[ip] {
			seen[ip] = true
			ips = append(ips, ip)
		}
	}
	return ips
}

// openBrowser opens the system browser at url; failing is fine.
func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		return
	}
	if err := cmd.Start(); err == nil {
		go cmd.Wait()
	}
}
