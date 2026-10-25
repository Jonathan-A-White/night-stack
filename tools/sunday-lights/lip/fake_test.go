package lip

import (
	"bufio"
	"fmt"
	"net"
	"strconv"
	"strings"
	"sync"
	"testing"
)

// fakeRepeater is a stand-in for a RadioRA 2 Main Repeater's Telnet port: it
// prompts for a login and password, shows "GNET> " once they match, and
// answers #OUTPUT and ?OUTPUT from its own level table.
type fakeRepeater struct {
	ln net.Listener

	login, password string

	// Behaviours a test turns on before dialling.
	refuseLogin bool // always say the login is bad and prompt again
	silent      bool // accept the connection and send nothing
	noEcho      bool // never echo a #OUTPUT
	noQuery     bool // never answer a ?OUTPUT
	iac         bool // open with Telnet option negotiation bytes
	upperPrompt bool // prompts in capitals ("LOGIN: ")

	mu     sync.Mutex
	levels map[int]string
	cmds   []string // every command line received after login
}

func newFakeRepeater(t *testing.T, login, password string) *fakeRepeater {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeRepeater{ln: ln, login: login, password: password, levels: map[int]string{}}
	t.Cleanup(func() { ln.Close() })
	return f
}

// start accepts connections until the test ends; call it after setting flags.
func (f *fakeRepeater) start() string {
	go func() {
		for {
			c, err := f.ln.Accept()
			if err != nil {
				return
			}
			go f.serve(c)
		}
	}()
	return f.ln.Addr().String()
}

func (f *fakeRepeater) setLevel(id int, level string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.levels[id] = level
}

func (f *fakeRepeater) level(id int) (string, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	l, ok := f.levels[id]
	return l, ok
}

func (f *fakeRepeater) commands() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.cmds...)
}

func (f *fakeRepeater) serve(c net.Conn) {
	defer c.Close()
	if f.silent {
		buf := make([]byte, 64)
		for {
			if _, err := c.Read(buf); err != nil {
				return
			}
		}
	}
	r := bufio.NewReader(c)
	loginPrompt, passPrompt := "login: ", "password: "
	if f.upperPrompt {
		loginPrompt, passPrompt = "LOGIN: ", "PASSWORD: "
	}
	if f.iac {
		// IAC DO ECHO, IAC WILL SGA, IAC SB ... IAC SE, and an escaped 0xFF.
		c.Write([]byte{255, 253, 1, 255, 251, 3, 255, 250, 24, 1, 255, 240})
	}
	for attempt := 0; attempt < 3; attempt++ {
		fmt.Fprint(c, loginPrompt)
		user, err := r.ReadString('\n')
		if err != nil {
			return
		}
		fmt.Fprint(c, passPrompt)
		pass, err := r.ReadString('\n')
		if err != nil {
			return
		}
		if !f.refuseLogin && strings.TrimSpace(user) == f.login && strings.TrimSpace(pass) == f.password {
			fmt.Fprint(c, "\r\nGNET> ")
			f.commandLoop(c, r)
			return
		}
		fmt.Fprint(c, "\r\nbad login\r\n")
	}
}

func (f *fakeRepeater) commandLoop(c net.Conn, r *bufio.Reader) {
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimSpace(line)
		f.mu.Lock()
		f.cmds = append(f.cmds, line)
		f.mu.Unlock()
		parts := strings.Split(line, ",")
		if len(parts) < 3 {
			fmt.Fprint(c, "GNET> ")
			continue
		}
		id, _ := strconv.Atoi(parts[1])
		switch {
		case strings.HasPrefix(line, "#OUTPUT,") && len(parts) >= 4:
			f.setLevel(id, parts[3])
			if !f.noEcho {
				fmt.Fprintf(c, "~OUTPUT,%d,1,%s\r\nGNET> ", id, parts[3])
			}
		case strings.HasPrefix(line, "?OUTPUT,"):
			if f.noQuery {
				continue
			}
			// An unrelated event first, to be skipped by the client.
			fmt.Fprint(c, "~DEVICE,99,3,3\r\n")
			l, ok := f.level(id)
			if !ok {
				l = "0.00"
			}
			fmt.Fprintf(c, "~OUTPUT,%d,1,%s\r\nGNET> ", id, l)
		default:
			fmt.Fprint(c, "GNET> ")
		}
	}
}
