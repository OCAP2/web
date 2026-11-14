package server

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"slices"
	"strings"
)

// DefaultRemoteIPHeaders are the headers read for the client address when the
// request comes from a trusted proxy and remoteIPHeaders is not configured.
var DefaultRemoteIPHeaders = []string{"X-Forwarded-For", "X-Real-IP"}

// ParseTrustedProxies parses IP addresses and CIDR ranges.
func ParseTrustedProxies(entries []string) ([]netip.Prefix, error) {
	var prefixes []netip.Prefix
	for _, entry := range entries {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		if strings.Contains(entry, "/") {
			p, err := netip.ParsePrefix(entry)
			if err != nil {
				return nil, fmt.Errorf("trusted proxy %q: %w", entry, err)
			}
			// Addresses are unmapped before matching, so an IPv4-mapped
			// prefix must become the equivalent IPv4 prefix.
			if p.Addr().Is4In6() {
				if p.Bits() < 96 {
					return nil, fmt.Errorf("trusted proxy %q: IPv4-mapped prefix must be at least /96", entry)
				}
				p = netip.PrefixFrom(p.Addr().Unmap(), p.Bits()-96)
			}
			prefixes = append(prefixes, p.Masked())
			continue
		}
		a, err := netip.ParseAddr(entry)
		if err != nil {
			return nil, fmt.Errorf("trusted proxy %q: %w", entry, err)
		}
		a = a.Unmap()
		prefixes = append(prefixes, netip.PrefixFrom(a, a.BitLen()))
	}
	return prefixes, nil
}

type clientIPResolver struct {
	trusted []netip.Prefix
	headers []string
}

func (c clientIPResolver) isTrusted(a netip.Addr) bool {
	a = a.Unmap()
	for _, p := range c.trusted {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

// clientIP returns the client address from the forwarding headers, but only
// when the direct peer is a trusted proxy. Each header is read right to left:
// trusted proxies are skipped and the first untrusted address is the client,
// as anything further left could have been sent by the client itself.
func (c clientIPResolver) clientIP(r *http.Request) (string, bool) {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil || !c.isTrusted(peer) {
		return "", false
	}

	for _, header := range c.headers {
		values := r.Header.Values(header)
		if len(values) == 0 {
			continue
		}
		items := strings.Split(strings.Join(values, ","), ",")
		for i, item := range slices.Backward(items) {
			ip, err := netip.ParseAddr(strings.TrimSpace(item))
			if err != nil {
				break // malformed header: try the next one
			}
			ip = ip.Unmap()
			if i == 0 || !c.isTrusted(ip) {
				return ip.String(), true
			}
		}
	}
	return "", false
}

// RealIPMiddleware replaces r.RemoteAddr with the client address taken from
// the forwarding headers when the request comes from a trusted proxy. With no
// trusted proxies headers are never read.
func RealIPMiddleware(trusted []netip.Prefix, headers []string) func(http.Handler) http.Handler {
	if len(headers) == 0 {
		headers = DefaultRemoteIPHeaders
	}
	resolver := clientIPResolver{trusted: trusted, headers: headers}
	return func(next http.Handler) http.Handler {
		if len(trusted) == 0 {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if ip, ok := resolver.clientIP(r); ok {
				r.RemoteAddr = ip
			}
			next.ServeHTTP(w, r)
		})
	}
}
