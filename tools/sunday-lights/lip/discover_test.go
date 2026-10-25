package lip

import (
	"context"
	"errors"
	"net"
	"sync/atomic"
	"testing"
	"time"
)

type fakeDialer struct {
	open    map[string]bool // "ip:23" that accept
	hang    bool            // block until ctx ends instead of refusing
	calls   atomic.Int32
	maxLive atomic.Int32
	live    atomic.Int32
}

func (d *fakeDialer) DialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	d.calls.Add(1)
	n := d.live.Add(1)
	defer d.live.Add(-1)
	for {
		m := d.maxLive.Load()
		if n <= m || d.maxLive.CompareAndSwap(m, n) {
			break
		}
	}
	if d.hang {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	time.Sleep(5 * time.Millisecond)
	if d.open[addr] {
		a, b := net.Pipe()
		go b.Close()
		return a, nil
	}
	return nil, errors.New("connection refused")
}

func okFetcher(ctx context.Context, address string) ([]Output, error) {
	return []Output{{IntegrationID: 1, Name: "x"}}, nil
}

func mustNet(t *testing.T, cidr string) *net.IPNet {
	t.Helper()
	ip, n, err := net.ParseCIDR(cidr)
	if err != nil {
		t.Fatal(err)
	}
	n.IP = ip // as net.Interface addresses carry the interface's own IP
	return n
}

func TestDiscoverFindsOneAmongMany(t *testing.T) {
	d := &fakeDialer{open: map[string]bool{"10.1.2.9:23": true, "10.1.2.200:23": true}}
	// Both accept 23, but only .9 serves a DbXmlInfo.xml.
	fetch := func(ctx context.Context, address string) ([]Output, error) {
		if address == "10.1.2.9" {
			return okFetcher(ctx, address)
		}
		return nil, errors.New("not DbXmlInfo")
	}
	got, err := Discover(context.Background(), d, fetch, []*net.IPNet{mustNet(t, "10.1.2.77/24")})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0] != "10.1.2.9" {
		t.Fatalf("got %v, want [10.1.2.9]", got)
	}
	if n := d.calls.Load(); n < 250 {
		t.Fatalf("only %d hosts dialled, want a whole /24", n)
	}
	if m := d.maxLive.Load(); m > 32 {
		t.Fatalf("%d dials at once, want at most 32", m)
	}
}

func TestDiscoverNoneFound(t *testing.T) {
	d := &fakeDialer{}
	got, err := Discover(context.Background(), d, okFetcher, []*net.IPNet{mustNet(t, "192.168.7.1/28")})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("got %v, want none", got)
	}
}

func TestDiscoverReturnsEveryRepeaterSorted(t *testing.T) {
	d := &fakeDialer{open: map[string]bool{"192.168.7.12:23": true, "192.168.7.3:23": true}}
	got, err := Discover(context.Background(), d, okFetcher, []*net.IPNet{mustNet(t, "192.168.7.1/28")})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0] != "192.168.7.3" || got[1] != "192.168.7.12" {
		t.Fatalf("got %v", got)
	}
}

func TestDiscoverSkipsOwnAddressesAndDedupes(t *testing.T) {
	d := &fakeDialer{open: map[string]bool{"192.168.7.1:23": true}}
	nets := []*net.IPNet{mustNet(t, "192.168.7.1/28"), mustNet(t, "192.168.7.2/28")}
	got, err := Discover(context.Background(), d, okFetcher, nets)
	if err != nil {
		t.Fatal(err)
	}
	// Hosts .1 to .14 of the shared /28, less the PC's own .1 and .2, each once.
	if n := d.calls.Load(); n != 12 {
		t.Fatalf("%d dials, want 12", n)
	}
	if len(got) != 0 {
		t.Fatalf("the PC's own address was reported: %v", got)
	}
}

func TestDiscoverEndsWithinTheBudget(t *testing.T) {
	d := &fakeDialer{hang: true}
	start := time.Now()
	// 14 hosts, all hanging; each gets 1.5 s and all run at once.
	got, err := Discover(context.Background(), d, okFetcher, []*net.IPNet{mustNet(t, "192.168.7.1/28")})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("got %v", got)
	}
	if el := time.Since(start); el < 1400*time.Millisecond || el > 2500*time.Millisecond {
		t.Fatalf("scan took %v, want about 1.5s", el)
	}
}

func TestDiscoverStopsWhenContextEnds(t *testing.T) {
	d := &fakeDialer{hang: true}
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := Discover(ctx, d, okFetcher, []*net.IPNet{mustNet(t, "192.168.7.1/24")})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err = %v, want deadline exceeded", err)
	}
	if el := time.Since(start); el > time.Second {
		t.Fatalf("took %v after cancel", el)
	}
}

func TestUsableNets(t *testing.T) {
	in := []net.Addr{
		mustNet(t, "127.0.0.1/8"),
		mustNet(t, "169.254.3.4/16"),
		mustNet(t, "fe80::1/64"),
		mustNet(t, "192.168.1.20/24"),
		mustNet(t, "10.0.0.5/16"),
	}
	got := filterNets(in)
	if len(got) != 2 {
		t.Fatalf("got %v, want the two private IPv4 nets", got)
	}
}
