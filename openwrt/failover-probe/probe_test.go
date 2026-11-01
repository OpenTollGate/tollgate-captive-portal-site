package main

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func status4() interfaceStatus {
	return interfaceStatus{Up: true, Device: "eth0.2", DNS: []string{"127.0.0.1", "192.0.2.53"}, IPv4: []address{{Address: "192.0.2.4"}}}
}

func TestCLIWhitelistsInterfaceAndTarget(t *testing.T) {
	for _, args := range [][]string{{"--interface", "wan;reboot", "--target", "1"}, {"--interface", "private", "--target", "1"}, {"--interface", "wan", "--target", "http://evil"}, {"--interface", "wan"}, {"--interface", "wan", "--target", "1", "extra"}} {
		if _, err := parseOptions(args); err == nil {
			t.Fatalf("accepted %q", args)
		}
	}
	for _, name := range []string{"wan", "wwan", "wan6", "wwan6"} {
		if _, err := parseOptions([]string{"--interface", name, "--target", "2"}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestNetifdStatusUsesCanonicalUbusWithoutShellAndHonorsCancellation(t *testing.T) {
	for _, name := range []string{"wan", "wwan", "wan6", "wwan6"} {
		ctx, cancel := context.WithCancel(context.Background())
		cmd, err := interfaceStatusCommand(ctx, name)
		if err != nil {
			t.Fatal(err)
		}
		want := []string{"/bin/ubus", "call", "network.interface." + name, "status"}
		if cmd.Path != "/bin/ubus" || !reflect.DeepEqual(cmd.Args, want) {
			t.Fatalf("status command=%q %q, want direct canonical ubus %q", cmd.Path, cmd.Args, want)
		}
		cancel()
		if err := cmd.Run(); !errors.Is(err, context.Canceled) {
			t.Fatalf("cancelled status command: %v", err)
		}
	}
	if cmd, err := interfaceStatusCommand(context.Background(), "wan;reboot"); err == nil || cmd != nil {
		t.Fatal("constructed command for invalid interface")
	}
}

func TestInterfaceBindingRejectsDownMissingAndWrongFamily(t *testing.T) {
	for _, tc := range []struct {
		status        interfaceStatus
		iface, reason string
	}{
		{interfaceStatus{}, "wan", "link-down"},
		{interfaceStatus{Up: true, Device: "lo"}, "wan", "no-address"},
		{interfaceStatus{Up: true, Device: "eth0;reboot", IPv4: []address{{Address: "192.0.2.4"}}}, "wan", "unavailable"},
		{status4(), "wan6", "no-address"},
		{interfaceStatus{Up: true, Device: "eth0", IPv4: []address{{Address: "127.0.0.1"}}}, "wan", "no-address"},
		{interfaceStatus{Up: true, Device: "eth0", IPv6: []address{{Address: "fe80::1"}}}, "wan6", "no-address"},
	} {
		_, reason := bindingFromStatus(tc.iface, tc.status)
		if reason != tc.reason {
			t.Fatalf("got %q want %q", reason, tc.reason)
		}
	}
}

func TestDNSPoolNeverUsesLocalResolverOrWrongFamily(t *testing.T) {
	b, reason := bindingFromStatus("wan", status4())
	if reason != "" {
		t.Fatal(reason)
	}
	servers := dnsServers(status4(), b)
	if len(servers) != 1 || servers[0] != "192.0.2.53:53" {
		t.Fatalf("servers %v", servers)
	}
	for _, s := range servers {
		if strings.Contains(s, "127.0.0.1") || strings.Contains(s, "[::") {
			t.Fatalf("unsafe DNS %q", s)
		}
	}
	s := interfaceStatus{Up: true, Device: "eth0", DNS: []string{"8.8.8.8", "::1", "2001:db8::53"}, IPv6: []address{{Address: "2001:db8::4"}}}
	b, reason = bindingFromStatus("wan6", s)
	if reason != "" {
		t.Fatal(reason)
	}
	servers = dnsServers(s, b)
	if servers[0] != "[2001:db8::53]:53" || b.Family != "6" {
		t.Fatalf("v6 %v %+v", servers, b)
	}
	for _, server := range servers {
		host, _, _ := net.SplitHostPort(server)
		if !netip.MustParseAddr(host).Is6() {
			t.Fatalf("v4 DNS in v6 probe %v", servers)
		}
	}
}

func TestOnlyMissingUsableDHCPDNSGetsPublicFallback(t *testing.T) {
	s := status4()
	b, _ := bindingFromStatus("wan", s)
	s.DNS = []string{"127.0.0.1", "::1", "192.0.2.4"}
	servers := dnsServers(s, b)
	if len(servers) != 2 || servers[0] != "1.1.1.1:53" || servers[1] != "8.8.8.8:53" {
		t.Fatalf("fallback %v", servers)
	}
	s.DNS = []string{"192.0.2.53", "192.0.2.54", "192.0.2.55"}
	servers = dnsServers(s, b)
	if len(servers) != 2 || servers[0] != "192.0.2.53:53" || servers[1] != "192.0.2.54:53" {
		t.Fatalf("DHCP %v", servers)
	}
}

func TestHTTPStatusRedirectAndBody(t *testing.T) {
	for _, tc := range []struct {
		code         int
		body, reason string
	}{{204, "", "ok"}, {200, "login", "captive-or-blocked"}, {302, "", "captive-or-blocked"}, {503, "", "captive-or-blocked"}, {204, "unexpected", "captive-or-blocked"}} {
		response := &http.Response{StatusCode: tc.code, Body: io.NopCloser(strings.NewReader(tc.body))}
		result := classifyHTTP(response, nil)
		if result.Reason != tc.reason || result.OK != (tc.reason == "ok") {
			t.Fatalf("%+v => %+v", tc, result)
		}
	}
	if r := classifyHTTP(nil, errors.New("timeout")); r.OK || r.Reason != "no-http" {
		t.Fatalf("%+v", r)
	}
}

func TestHTTPDoesNotFollowRedirectAndBindsSocket(t *testing.T) {
	var followed atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/final" {
			followed.Add(1)
			w.WriteHeader(204)
			return
		}
		w.Header().Set("Location", "/final")
		w.WriteHeader(302)
	}))
	defer server.Close()
	var controls atomic.Int32
	b := binding{Device: "lo", Source: netip.MustParseAddr("127.0.0.1"), Family: "4"}
	client := boundHTTPClient(b, []netip.Addr{netip.MustParseAddr("127.0.0.1")}, func(string, string, syscallRawConn) error { controls.Add(1); return nil })
	response, err := client.Get(server.URL)
	result := classifyHTTP(response, err)
	if result.OK || result.Reason != "captive-or-blocked" || followed.Load() != 0 || controls.Load() == 0 {
		t.Fatalf("result=%+v followed=%d controls=%d", result, followed.Load(), controls.Load())
	}
}

func TestHTTPTimeoutIsBounded(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer server.Close()
	b := binding{Device: "lo", Source: netip.MustParseAddr("127.0.0.1"), Family: "4"}
	client := boundHTTPClient(b, []netip.Addr{b.Source}, func(string, string, syscallRawConn) error { return nil })
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", server.URL, nil)
	started := time.Now()
	response, err := client.Do(req)
	if r := classifyHTTP(response, err); r.OK || r.Reason != "no-http" {
		t.Fatalf("%+v", r)
	}
	if time.Since(started) > time.Second {
		t.Fatal("request ignored context deadline")
	}
}

func TestDNSActuallyQueriesSelectedServerAndBindsSocket(t *testing.T) {
	listener, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		packet := make([]byte, 1024)
		n, peer, e := listener.ReadFrom(packet)
		if e != nil || n < 12 {
			return
		}
		end := 12
		for end < n && packet[end] != 0 {
			end += 1 + int(packet[end])
		}
		end += 5 // zero label terminator, query type, query class
		if end > n {
			return
		}
		response := append([]byte{}, packet[:end]...)
		response[2] = 0x81
		response[3] = 0x80
		response[6] = 0
		response[7] = 1
		response[8] = 0
		response[9] = 0
		response[10] = 0
		response[11] = 0
		response = append(response, 0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 30, 0, 4, 192, 0, 2, 25)
		_, _ = listener.WriteTo(response, peer)
	}()
	var controls atomic.Int32
	b := binding{Device: "lo", Source: netip.MustParseAddr("127.0.0.1"), Family: "4"}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	ips, err := lookupServer(ctx, "probe.invalid", listener.LocalAddr().String(), b, func(string, string, syscallRawConn) error { controls.Add(1); return nil })
	if err != nil || len(ips) != 1 || ips[0].String() != "192.0.2.25" || controls.Load() == 0 {
		t.Fatalf("ips=%v err=%v controls=%d", ips, err, controls.Load())
	}
}

func TestDiagnosticStateIsAtomicAndContainsNoNetworkSecrets(t *testing.T) {
	dir := t.TempDir()
	if err := os.Chmod(dir, 0755); err != nil {
		t.Fatal(err)
	}
	opt := options{Interface: "wwan", Target: 2}
	if err := writeState(dir, opt, result{OK: true, Reason: "ok"}, time.Unix(1234, 0)); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "wwan-2.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{`"ok":true`, `"reason":"ok"`, `"interface":"wwan"`, `"target":2`, `"checked_at":1234`} {
		if !strings.Contains(string(data), key) {
			t.Fatalf("missing %s in %s", key, data)
		}
	}
	if strings.Contains(string(data), "dns") || strings.Contains(string(data), "password") || strings.Contains(string(data), "address") {
		t.Fatalf("unexpected metadata %s", data)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatalf("left temporary files: %v", entries)
	}
	link := filepath.Join(t.TempDir(), "state")
	if err := os.Symlink(dir, link); err != nil {
		t.Fatal(err)
	}
	if err := writeState(link, opt, result{}, time.Now()); err == nil {
		t.Fatal("accepted symlink state directory")
	}
}

func TestHTTPIgnoresProxyEnvironment(t *testing.T) {
	t.Setenv("HTTP_PROXY", "http://127.0.0.1:9")
	t.Setenv("ALL_PROXY", "http://127.0.0.1:9")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	defer server.Close()
	b := binding{Device: "lo", Source: netip.MustParseAddr("127.0.0.1"), Family: "4"}
	client := boundHTTPClient(b, []netip.Addr{b.Source}, func(string, string, syscallRawConn) error { return nil })
	response, err := client.Get(server.URL)
	if r := classifyHTTP(response, err); !r.OK {
		t.Fatalf("proxy environment influenced request: %+v", r)
	}
}

func TestProbeDoesNotAttemptHTTPAfterDNSFailure(t *testing.T) {
	var httpCalls int
	r := runProbe(context.Background(), options{Interface: "wan", Target: 1}, dependencies{
		Status: func(context.Context, string) (interfaceStatus, error) { return status4(), nil },
		Lookup: func(context.Context, string, []string, binding) ([]netip.Addr, error) {
			return nil, errors.New("DNS unavailable")
		},
		HTTP: func(context.Context, string, binding, []netip.Addr) result {
			httpCalls++
			return result{OK: true, Reason: "ok"}
		},
	})
	if r.OK || r.Reason != "no-dns" || httpCalls != 0 {
		t.Fatalf("r=%+v calls=%d", r, httpCalls)
	}
}
