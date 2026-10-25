// Package lip talks to a Lutron RadioRA 2 Main Repeater: the Lutron
// Integration Protocol over Telnet (client.go), the DbXmlInfo.xml the
// repeater serves over HTTP (dbxml.go), and a scan of the local network for
// repeaters (discover.go).
package lip

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ReadTimeout bounds every wait for the repeater when the caller's context
// carries no sooner deadline.
const ReadTimeout = 5 * time.Second

// ErrBadLogin means the repeater did not accept the login and password: it
// asked for them again or hung up instead of showing its GNET> prompt.
var ErrBadLogin = errors.New("lip: the repeater refused the login or password")

// Telnet bytes (RFC 854): IAC introduces a command; WILL, WONT, DO and DONT
// carry one option byte; SB runs to IAC SE.
const (
	iacSE   = 240
	iacSB   = 250
	iacWILL = 251
	iacDONT = 254
	iac     = 255
)

const prompt = "GNET>"

// Client is one logged-in LIP session. It is safe for one goroutine at a
// time; calls from several are serialised.
type Client struct {
	// EchoWait is how long SetOutput waits for the repeater's ~OUTPUT echo
	// of a change before it carries on without one. Dial sets it to one second.
	EchoWait time.Duration

	mu   sync.Mutex
	conn net.Conn
	r    *bufio.Reader
}

// Dial connects to the repeater's Telnet port and logs in. The address is a
// host or host:port; without a port, 23 is used. Nothing in an error from
// Dial contains the password.
func Dial(ctx context.Context, address, login, password string) (*Client, error) {
	var d net.Dialer
	conn, err := d.DialContext(ctx, "tcp", withDefaultPort(address))
	if err != nil {
		return nil, fmt.Errorf("lip: connecting to %s: %w", address, err)
	}
	c := &Client{EchoWait: time.Second, conn: conn, r: bufio.NewReader(conn)}
	if err := c.login(ctx, login, password); err != nil {
		conn.Close()
		return nil, err
	}
	return c, nil
}

func (c *Client) login(ctx context.Context, login, password string) error {
	if _, _, err := c.expect(ctx, ReadTimeout, "login:"); err != nil {
		return fmt.Errorf("lip: waiting for the login prompt: %w", err)
	}
	if err := c.send(ctx, login); err != nil {
		return err
	}
	which, _, err := c.expect(ctx, ReadTimeout, "password:", "login:")
	if errors.Is(err, io.EOF) || which == 1 {
		return ErrBadLogin
	}
	if err != nil {
		return fmt.Errorf("lip: waiting for the password prompt: %w", err)
	}
	if err := c.send(ctx, password); err != nil {
		return err
	}
	which, _, err = c.expect(ctx, ReadTimeout, prompt, "login:")
	if errors.Is(err, io.EOF) || which == 1 {
		return ErrBadLogin
	}
	if err != nil {
		return fmt.Errorf("lip: waiting for the %s prompt: %w", prompt, err)
	}
	return nil
}

// SetOutput sends #OUTPUT,<id>,1,<level>,<fade>: level is 0 to 100 and
// fadeSeconds is how long the repeater takes to get there. It then waits up to
// EchoWait for the repeater's ~OUTPUT echo; a repeater that does not echo is
// not an error here, since GetOutput is the real confirmation.
func (c *Client) SetOutput(ctx context.Context, id int, level, fadeSeconds float64) error {
	if math.IsNaN(level) || level < 0 || level > 100 {
		return fmt.Errorf("lip: level %v is outside 0 to 100", level)
	}
	if math.IsNaN(fadeSeconds) || fadeSeconds < 0 {
		return fmt.Errorf("lip: fade %v seconds is negative", fadeSeconds)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	cmd := fmt.Sprintf("#OUTPUT,%d,1,%s,%s", id, formatNumber(level, 1), formatNumber(fadeSeconds, 2))
	if err := c.send(ctx, cmd); err != nil {
		return err
	}
	_, err := c.readOutput(ctx, id, c.EchoWait)
	if err != nil && ctx.Err() == nil && isTimeout(err) {
		return nil
	}
	return err
}

// GetOutput sends ?OUTPUT,<id>,1 and returns the level the repeater reports
// in the matching ~OUTPUT line. Other lines in between are skipped.
func (c *Client) GetOutput(ctx context.Context, id int) (float64, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.send(ctx, fmt.Sprintf("?OUTPUT,%d,1", id)); err != nil {
		return 0, err
	}
	level, err := c.readOutput(ctx, id, ReadTimeout)
	if err != nil {
		return 0, fmt.Errorf("lip: reading output %d: %w", id, err)
	}
	return level, nil
}

// Close ends the session.
func (c *Client) Close() error { return c.conn.Close() }

// readOutput reads lines until a ~OUTPUT,<id>,1,<level> arrives.
func (c *Client) readOutput(ctx context.Context, id int, wait time.Duration) (float64, error) {
	defer c.arm(ctx, wait)()
	want := fmt.Sprintf("~OUTPUT,%d,1,", id)
	for {
		line, err := c.readLine()
		if err != nil {
			return 0, c.mapErr(ctx, err)
		}
		for strings.HasPrefix(line, prompt) {
			line = strings.TrimSpace(strings.TrimPrefix(line, prompt))
		}
		if !strings.HasPrefix(line, want) {
			continue
		}
		field, _, _ := strings.Cut(line[len(want):], ",")
		level, err := strconv.ParseFloat(strings.TrimSpace(field), 64)
		if err != nil {
			return 0, fmt.Errorf("lip: unreadable level in %q", line)
		}
		return level, nil
	}
}

func (c *Client) send(ctx context.Context, line string) error {
	defer c.arm(ctx, ReadTimeout)()
	if _, err := c.conn.Write([]byte(line + "\r\n")); err != nil {
		return c.mapErr(ctx, fmt.Errorf("lip: sending: %w", err))
	}
	return nil
}

// expect reads until one of the tokens (matched without regard to case)
// has arrived; it returns which one, and the text read.
func (c *Client) expect(ctx context.Context, wait time.Duration, tokens ...string) (int, string, error) {
	defer c.arm(ctx, wait)()
	var buf strings.Builder
	for {
		b, err := c.readByte()
		if err != nil {
			return -1, buf.String(), c.mapErr(ctx, err)
		}
		buf.WriteByte(b)
		if buf.Len() > 1<<16 {
			return -1, "", errors.New("lip: the repeater sent too much without a prompt")
		}
		low := strings.ToLower(buf.String())
		for i, t := range tokens {
			if strings.Contains(low, strings.ToLower(t)) {
				return i, buf.String(), nil
			}
		}
	}
}

// arm puts a deadline on the connection (the sooner of the context's and
// now+wait) and makes a cancelled context cut the read short. Call the
// returned func when the wait is over.
func (c *Client) arm(ctx context.Context, wait time.Duration) func() {
	deadline := time.Now().Add(wait)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	c.conn.SetDeadline(deadline)
	stop := context.AfterFunc(ctx, func() { c.conn.SetDeadline(time.Unix(1, 0)) })
	return func() { stop() }
}

// mapErr reports the context's error when the context is what cut the read.
func (c *Client) mapErr(ctx context.Context, err error) error {
	if cerr := ctx.Err(); cerr != nil {
		return cerr
	}
	if isTimeout(err) {
		return fmt.Errorf("timed out waiting for the repeater: %w", os.ErrDeadlineExceeded)
	}
	return err
}

func isTimeout(err error) bool {
	var ne net.Error
	return errors.Is(err, os.ErrDeadlineExceeded) || (errors.As(err, &ne) && ne.Timeout())
}

// readLine returns the next line with Telnet commands removed and the line
// ending trimmed. Data before an EOF is returned as a last line.
func (c *Client) readLine() (string, error) {
	var sb strings.Builder
	for {
		b, err := c.readByte()
		if err != nil {
			if errors.Is(err, io.EOF) && sb.Len() > 0 {
				return strings.TrimSpace(sb.String()), nil
			}
			return "", err
		}
		if b == '\n' {
			return strings.TrimSpace(sb.String()), nil
		}
		sb.WriteByte(b)
		if sb.Len() > 1<<16 {
			return "", errors.New("lip: line too long")
		}
	}
}

// readByte returns the next data byte, dropping Telnet negotiation (IAC
// commands and sub-negotiations); IAC IAC is a literal 255.
func (c *Client) readByte() (byte, error) {
	for {
		b, err := c.r.ReadByte()
		if err != nil {
			return 0, err
		}
		if b != iac {
			return b, nil
		}
		cmd, err := c.r.ReadByte()
		if err != nil {
			return 0, err
		}
		switch {
		case cmd == iac:
			return iac, nil
		case cmd >= iacWILL && cmd <= iacDONT:
			if _, err := c.r.ReadByte(); err != nil {
				return 0, err
			}
		case cmd == iacSB:
			for {
				x, err := c.r.ReadByte()
				if err != nil {
					return 0, err
				}
				if x != iac {
					continue
				}
				y, err := c.r.ReadByte()
				if err != nil {
					return 0, err
				}
				if y == iacSE {
					break
				}
			}
		}
	}
}

// withDefaultPort adds :23 to an address that has no port.
func withDefaultPort(address string) string {
	if _, _, err := net.SplitHostPort(address); err == nil {
		return address
	}
	return net.JoinHostPort(strings.Trim(address, "[]"), "23")
}

// formatNumber writes v rounded to the given decimals, without a decimal
// point when it is whole.
func formatNumber(v float64, decimals int) string {
	scale := math.Pow10(decimals)
	r := math.Round(v*scale) / scale
	return strconv.FormatFloat(r, 'f', -1, 64)
}
