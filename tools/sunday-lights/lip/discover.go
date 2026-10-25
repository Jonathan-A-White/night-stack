package lip

import (
	"context"
	"net"
	"net/http"
	"sort"
	"sync"
	"time"
)

// Scan limits: how many hosts are probed at once, and how long one host gets
// for its Telnet connect and its DbXmlInfo.xml together.
const (
	Concurrency = 32
	HostTimeout = 1500 * time.Millisecond
)

// Dialer opens connections; *net.Dialer is one.
type Dialer interface {
	DialContext(ctx context.Context, network, address string) (net.Conn, error)
}

// Fetcher reads the outputs a host serves in DbXmlInfo.xml; an error means the
// host is not a repeater.
type Fetcher func(ctx context.Context, address string) ([]Output, error)

// HTTPFetcher is a Fetcher over FetchOutputs.
func HTTPFetcher(client *http.Client) Fetcher {
	return func(ctx context.Context, address string) ([]Output, error) {
		return FetchOutputs(ctx, client, address)
	}
}

// LocalNets lists the PC's IPv4 networks, leaving out loopback and
// link-local ones.
func LocalNets() ([]*net.IPNet, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}
	var addrs []net.Addr
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 {
			continue
		}
		a, err := ifc.Addrs()
		if err != nil {
			continue
		}
		addrs = append(addrs, a...)
	}
	return filterNets(addrs), nil
}

func filterNets(addrs []net.Addr) []*net.IPNet {
	var out []*net.IPNet
	for _, a := range addrs {
		n, ok := a.(*net.IPNet)
		if !ok {
			continue
		}
		ip := n.IP.To4()
		if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
			continue
		}
		out = append(out, n)
	}
	return out
}

// Discover probes the hosts of the given IPv4 networks (a network wider than
// a /24 is cut down to the /24 around its address) and returns, sorted, each
// host that accepts TCP port 23 and serves a DbXmlInfo.xml that parses. The
// PC's own addresses are not probed. It returns what it found so far, with
// ctx's error, if ctx ends first.
func Discover(ctx context.Context, dialer Dialer, fetch Fetcher, localNets []*net.IPNet) ([]string, error) {
	hosts := scanHosts(localNets)
	var (
		mu    sync.Mutex
		found []string
		wg    sync.WaitGroup
	)
	sem := make(chan struct{}, Concurrency)
loop:
	for _, h := range hosts {
		select {
		case sem <- struct{}{}:
		case <-ctx.Done():
			break loop
		}
		wg.Add(1)
		go func(host string) {
			defer wg.Done()
			defer func() { <-sem }()
			if probe(ctx, dialer, fetch, host) {
				mu.Lock()
				found = append(found, host)
				mu.Unlock()
			}
		}(h)
	}
	wg.Wait()
	sort.Slice(found, func(i, j int) bool { return lessIP(found[i], found[j]) })
	return found, ctx.Err()
}

func probe(ctx context.Context, dialer Dialer, fetch Fetcher, host string) bool {
	ctx, cancel := context.WithTimeout(ctx, HostTimeout)
	defer cancel()
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(host, "23"))
	if err != nil {
		return false
	}
	conn.Close()
	outs, err := fetch(ctx, host)
	return err == nil && outs != nil
}

// scanHosts lists each host to probe once, in address order.
func scanHosts(nets []*net.IPNet) []string {
	own := map[string]bool{}
	for _, n := range nets {
		if ip := n.IP.To4(); ip != nil {
			own[ip.String()] = true
		}
	}
	seen := map[string]bool{}
	var hosts []string
	for _, n := range nets {
		ip := n.IP.To4()
		if ip == nil {
			continue
		}
		ones, bits := n.Mask.Size()
		if bits != 32 {
			continue
		}
		if ones < 24 {
			ones = 24
		}
		mask := net.CIDRMask(ones, 32)
		base := ip.Mask(mask)
		size := 1 << (32 - ones)
		for i := 0; i < size; i++ {
			h := make(net.IP, 4)
			copy(h, base)
			v := (uint32(base[0])<<24 | uint32(base[1])<<16 | uint32(base[2])<<8 | uint32(base[3])) + uint32(i)
			h[0], h[1], h[2], h[3] = byte(v>>24), byte(v>>16), byte(v>>8), byte(v)
			if ones <= 30 && (i == 0 || i == size-1) {
				continue // network and broadcast addresses
			}
			s := h.String()
			if own[s] || seen[s] {
				continue
			}
			seen[s] = true
			hosts = append(hosts, s)
		}
	}
	return hosts
}

func lessIP(a, b string) bool {
	return string(net.ParseIP(a).To16()) < string(net.ParseIP(b).To16())
}
