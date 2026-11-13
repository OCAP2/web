package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseTrustedProxies(t *testing.T) {
	prefixes, err := ParseTrustedProxies([]string{" 172.18.0.0/16 ", "10.0.0.5", "::ffff:192.168.1.1", "fd00::/8", ""})
	require.NoError(t, err)
	got := make([]string, len(prefixes))
	for i, p := range prefixes {
		got[i] = p.String()
	}
	assert.Equal(t, []string{"172.18.0.0/16", "10.0.0.5/32", "192.168.1.1/32", "fd00::/8"}, got)

	for _, bad := range []string{"proxy.local", "10.0.0.0/33", "300.1.1.1"} {
		_, err := ParseTrustedProxies([]string{bad})
		assert.Error(t, err, bad)
	}
}

func TestRealIPMiddleware(t *testing.T) {
	trusted, err := ParseTrustedProxies([]string{"172.18.0.0/16", "10.0.0.1"})
	require.NoError(t, err)

	tests := []struct {
		name       string
		trusted    []string
		headers    []string
		remoteAddr string
		set        map[string][]string
		wantAddr   string
		wantProxy  string
	}{
		{
			name:       "no trusted proxies ignores headers",
			trusted:    []string{},
			remoteAddr: "172.18.0.2:4000",
			set:        map[string][]string{"X-Forwarded-For": {"1.2.3.4"}},
			wantAddr:   "172.18.0.2:4000",
		},
		{
			name:       "untrusted peer ignores headers",
			remoteAddr: "8.8.8.8:4000",
			set:        map[string][]string{"X-Forwarded-For": {"1.2.3.4"}},
			wantAddr:   "8.8.8.8:4000",
		},
		{
			name:       "trusted peer uses X-Forwarded-For",
			remoteAddr: "172.18.0.2:4000",
			set:        map[string][]string{"X-Forwarded-For": {"1.2.3.4"}},
			wantAddr:   "1.2.3.4",
			wantProxy:  "172.18.0.2:4000",
		},
		{
			name:       "spoofed left entries are skipped",
			remoteAddr: "172.18.0.2:4000",
			set:        map[string][]string{"X-Forwarded-For": {"9.9.9.9, 1.2.3.4, 10.0.0.1"}},
			wantAddr:   "1.2.3.4",
			wantProxy:  "172.18.0.2:4000",
		},
		{
			name:       "multiple header lines are joined",
			remoteAddr: "172.18.0.2:4000",
			set:        map[string][]string{"X-Forwarded-For": {"9.9.9.9", "1.2.3.4"}},
			wantAddr:   "1.2.3.4",
			wantProxy:  "172.18.0.2:4000",
		},
		{
			name:       "all entries trusted gives leftmost",
			remoteAddr: "172.18.0.2:4000",
			set:        map[string][]string{"X-Forwarded-For": {"172.18.0.9, 10.0.0.1"}},
			wantAddr:   "172.18.0.9",
			wantProxy:  "172.18.0.2:4000",
		},
		{
			name:       "malformed header falls back to next header",
			remoteAddr: "172.18.0.2:4000",
			set:        map[string][]string{"X-Forwarded-For": {"garbage"}, "X-Real-IP": {"5.6.7.8"}},
			wantAddr:   "5.6.7.8",
			wantProxy:  "172.18.0.2:4000",
		},
		{
			name:       "no header keeps RemoteAddr",
			remoteAddr: "172.18.0.2:4000",
			wantAddr:   "172.18.0.2:4000",
		},
		{
			name:       "configured header only",
			headers:    []string{"CF-Connecting-IP"},
			remoteAddr: "172.18.0.2:4000",
			set:        map[string][]string{"X-Forwarded-For": {"9.9.9.9"}, "Cf-Connecting-Ip": {"2001:db8::1"}},
			wantAddr:   "2001:db8::1",
			wantProxy:  "172.18.0.2:4000",
		},
		{
			name:       "IPv4-mapped peer and client are unmapped",
			remoteAddr: "[::ffff:10.0.0.1]:4000",
			set:        map[string][]string{"X-Forwarded-For": {"::ffff:1.2.3.4"}},
			wantAddr:   "1.2.3.4",
			wantProxy:  "[::ffff:10.0.0.1]:4000",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tp := trusted
			if tt.trusted != nil {
				tp, err = ParseTrustedProxies(tt.trusted)
				require.NoError(t, err)
			}
			var gotAddr, gotProxy string
			h := RealIPMiddleware(tp, tt.headers)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				gotAddr = r.RemoteAddr
				gotProxy, _ = ProxyAddr(r)
			}))

			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr = tt.remoteAddr
			for k, vs := range tt.set {
				for _, v := range vs {
					req.Header.Add(k, v)
				}
			}
			h.ServeHTTP(httptest.NewRecorder(), req)

			assert.Equal(t, tt.wantAddr, gotAddr)
			assert.Equal(t, tt.wantProxy, gotProxy)
		})
	}
}
