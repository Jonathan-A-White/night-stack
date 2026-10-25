// Package fakelip is a stand-in for a RadioRA 2 Main Repeater, for the tests
// of the packages that use the lip client: a Telnet port that wants a login
// and password and answers #OUTPUT and ?OUTPUT from a level table, and a
// DbXmlInfo.xml server. It reaches nothing outside 127.0.0.1.
package fakelip

import (
	"bufio"
	"context"
	"fmt"
	"html"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/lip"
)

// Repeater is the fake Telnet port.
type Repeater struct {
	Login, Password string

	// BadRead lists outputs whose ?OUTPUT is answered with a level that is
	// not a number, so that reading them back fails at once.
	BadRead map[int]bool

	// Logins counts the login and password pairs received, good or bad.
	mu     sync.Mutex
	levels map[int]string
	cmds   []string
	logins []string
	ln     net.Listener
}

// Start listens on a free port of 127.0.0.1 until the test ends and returns
// the Repeater and its host:port.
func Start(t *testing.T, login, password string) (*Repeater, string) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	r := &Repeater{Login: login, Password: password, BadRead: map[int]bool{}, levels: map[int]string{}, ln: ln}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go r.serve(c)
		}
	}()
	return r, ln.Addr().String()
}

// Level is the level last set on an output.
func (r *Repeater) Level(id int) (string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	l, ok := r.levels[id]
	return l, ok
}

// Commands lists every command received after a login, in order.
func (r *Repeater) Commands() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.cmds...)
}

// LoginAttempts lists the "login/password" pairs the repeater was offered.
func (r *Repeater) LoginAttempts() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.logins...)
}

const (
	askLogin  = "login: "
	askSecret = "password: "
)

func (r *Repeater) serve(c net.Conn) {
	defer c.Close()
	br := bufio.NewReader(c)
	for attempt := 0; attempt < 3; attempt++ {
		fmt.Fprint(c, askLogin)
		user, err := br.ReadString('\n')
		if err != nil {
			return
		}
		fmt.Fprint(c, askSecret)
		pass, err := br.ReadString('\n')
		if err != nil {
			return
		}
		user, pass = strings.TrimSpace(user), strings.TrimSpace(pass)
		r.mu.Lock()
		r.logins = append(r.logins, user+"/"+pass)
		r.mu.Unlock()
		if user == r.Login && pass == r.Password {
			fmt.Fprint(c, "\r\nGNET> ")
			r.commands(c, br)
			return
		}
		fmt.Fprint(c, "\r\nbad login\r\n")
	}
}

func (r *Repeater) commands(c net.Conn, br *bufio.Reader) {
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimSpace(line)
		r.mu.Lock()
		r.cmds = append(r.cmds, line)
		r.mu.Unlock()
		parts := strings.Split(line, ",")
		if len(parts) < 3 {
			fmt.Fprint(c, "GNET> ")
			continue
		}
		id, _ := strconv.Atoi(parts[1])
		switch {
		case strings.HasPrefix(line, "#OUTPUT,") && len(parts) >= 4:
			r.mu.Lock()
			r.levels[id] = parts[3]
			r.mu.Unlock()
			fmt.Fprintf(c, "~OUTPUT,%d,1,%s\r\nGNET> ", id, parts[3])
		case strings.HasPrefix(line, "?OUTPUT,"):
			fmt.Fprint(c, "~DEVICE,99,3,3\r\n") // an event to be skipped
			l, ok := r.Level(id)
			if !ok {
				l = "0.00"
			}
			if r.BadRead[id] {
				l = "n/a"
			}
			fmt.Fprintf(c, "~OUTPUT,%d,1,%s\r\nGNET> ", id, l)
		default:
			fmt.Fprint(c, "GNET> ")
		}
	}
}

// XML serves a DbXmlInfo.xml listing the outputs, all in one Area, and
// returns its host:port.
func XML(t *testing.T, outputs []lip.Output) string {
	t.Helper()
	var sb strings.Builder
	sb.WriteString(`<?xml version="1.0" encoding="utf-8"?><Project><Areas><Area Name="Sanctuary"><Outputs>`)
	for _, o := range outputs {
		fmt.Fprintf(&sb, `<Output Name="%s" IntegrationID="%d" OutputType="INC"/>`, html.EscapeString(o.Name), o.IntegrationID)
	}
	sb.WriteString(`</Outputs></Area></Areas></Project>`)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path != "/DbXmlInfo.xml" {
			http.NotFound(w, req)
			return
		}
		w.Write([]byte(sb.String()))
	}))
	t.Cleanup(srv.Close)
	return strings.TrimPrefix(srv.URL, "http://")
}

// Address is the name a Rig answers to; it is not a real host.
const Address = "fake-repeater"

// Rig is a Repeater and an XML server that answer to Address, with Dial and
// Fetch to hand to code that takes them as functions.
type Rig struct {
	*Repeater
	telnet, xml string
}

// NewRig starts both fakes; the outputs are what DbXmlInfo.xml lists.
func NewRig(t *testing.T, login, password string, outputs []lip.Output) *Rig {
	t.Helper()
	rep, telnet := Start(t, login, password)
	return &Rig{Repeater: rep, telnet: telnet, xml: XML(t, outputs)}
}

// Dial is lip.Dial against the fake.
func (g *Rig) Dial(ctx context.Context, address, login, password string) (*lip.Client, error) {
	if address != Address {
		return nil, fmt.Errorf("fakelip: no repeater at %q", address)
	}
	return lip.Dial(ctx, g.telnet, login, password)
}

// Fetch is lip.FetchOutputs against the fake.
func (g *Rig) Fetch(ctx context.Context, address string) ([]lip.Output, error) {
	if address != Address {
		return nil, fmt.Errorf("fakelip: no repeater at %q", address)
	}
	return lip.FetchOutputs(ctx, nil, g.xml)
}
