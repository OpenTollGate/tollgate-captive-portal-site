// TollGate's per-uplink DNS/HTTP health probe. Linux only; no third-party modules.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const probeTimeout = 4 * time.Second
const defaultMark = 0x3f00 // mwan3's MMX_DEFAULT: bypass its uplink-selection policy.
const stateDirectory = "/var/run/tollgate-uplink-probe"

type options struct {
	Interface string
	Target    int
}
type result struct {
	OK     bool   `json:"ok"`
	Reason string `json:"reason"`
}
type address struct {
	Address string `json:"address"`
}
type interfaceStatus struct {
	Up     bool      `json:"up"`
	Device string    `json:"l3_device"`
	DNS    []string  `json:"dns-server"`
	IPv4   []address `json:"ipv4-address"`
	IPv6   []address `json:"ipv6-address"`
}
type binding struct {
	Device, Family string
	Source         netip.Addr
}
type syscallRawConn = syscall.RawConn
type socketControlFn func(string, string, syscall.RawConn) error
type dependencies struct {
	Status func(context.Context, string) (interfaceStatus, error)
	Lookup func(context.Context, string, []string, binding) ([]netip.Addr, error)
	HTTP   func(context.Context, string, binding, []netip.Addr) result
}

var devicePattern = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,15}$`)
var endpoints = map[int]string{
	1: "http://connectivitycheck.gstatic.com/generate_204",
	2: "http://cp.cloudflare.com/generate_204",
}

func parseOptions(args []string) (options, error) {
	var opt options
	fs := flag.NewFlagSet("uplink-probe", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.StringVar(&opt.Interface, "interface", "", "fixed OpenWrt uplink name")
	fs.IntVar(&opt.Target, "target", 0, "probe endpoint 1 or 2")
	if err := fs.Parse(args); err != nil {
		return opt, err
	}
	if fs.NArg() != 0 {
		return opt, errors.New("unexpected arguments")
	}
	switch opt.Interface {
	case "wan", "wwan", "wan6", "wwan6":
	default:
		return opt, errors.New("unsupported interface")
	}
	if _, ok := endpoints[opt.Target]; !ok {
		return opt, errors.New("unsupported target")
	}
	return opt, nil
}

func main() {
	opt, err := parseOptions(os.Args[1:])
	if err != nil {
		_ = json.NewEncoder(os.Stdout).Encode(result{Reason: "invalid-arguments"})
		os.Exit(2)
	}
	ctx, cancel := context.WithTimeout(context.Background(), probeTimeout)
	r := runProbe(ctx, opt, dependencies{Status: readInterfaceStatus, Lookup: lookupBound, HTTP: requestBound})
	cancel()
	// State is diagnostic only; mwan3 consumes the process exit status. Failure
	// to persist diagnostics cannot turn an unhealthy probe into a healthy one.
	_ = writeState(stateDirectory, opt, r, time.Now())
	_ = json.NewEncoder(os.Stdout).Encode(r)
	if !r.OK {
		os.Exit(1)
	}
}

func runProbe(ctx context.Context, opt options, dep dependencies) result {
	status, err := dep.Status(ctx, opt.Interface)
	if err != nil {
		return result{Reason: "unavailable"}
	}
	b, reason := bindingFromStatus(opt.Interface, status)
	if reason != "" {
		return result{Reason: reason}
	}
	url := endpoints[opt.Target]
	host := strings.Split(strings.TrimPrefix(url, "http://"), "/")[0]
	ips, err := dep.Lookup(ctx, host, dnsServers(status, b), b)
	if err != nil || len(ips) == 0 {
		return result{Reason: "no-dns"}
	}
	return dep.HTTP(ctx, url, b, ips)
}

func bindingFromStatus(name string, status interfaceStatus) (binding, string) {
	var b binding
	if !status.Up {
		return b, "link-down"
	}
	if !devicePattern.MatchString(status.Device) {
		return b, "unavailable"
	}
	b.Device = status.Device
	b.Family = "4"
	candidates := status.IPv4
	if strings.HasSuffix(name, "6") {
		b.Family = "6"
		candidates = status.IPv6
	}
	for _, candidate := range candidates {
		ip, err := netip.ParseAddr(candidate.Address)
		if err != nil {
			continue
		}
		ip = ip.Unmap()
		if ip.IsGlobalUnicast() && !ip.IsLinkLocalUnicast() && ((b.Family == "4" && ip.Is4()) || (b.Family == "6" && ip.Is6())) {
			b.Source = ip
			return b, ""
		}
	}
	return b, "no-address"
}

func dnsServers(status interfaceStatus, b binding) []string {
	var servers []string
	seen := map[netip.Addr]bool{}
	add := func(text string) {
		ip, err := netip.ParseAddr(text)
		if err != nil {
			return
		}
		ip = ip.Unmap()
		if !ip.IsGlobalUnicast() || ip.IsLinkLocalUnicast() || ip == b.Source || seen[ip] || (b.Family == "4" && !ip.Is4()) || (b.Family == "6" && !ip.Is6()) {
			return
		}
		seen[ip] = true
		servers = append(servers, net.JoinHostPort(ip.String(), "53"))
	}
	for _, server := range status.DNS {
		if len(servers) >= 2 {
			break
		}
		add(server)
	}
	// A supplied but broken DHCP resolver must fail this uplink's check.
	// Bypassing it could mark a path healthy while guest DNS remains broken.
	if len(servers) > 0 {
		return servers
	}
	if b.Family == "4" {
		add("1.1.1.1")
		add("8.8.8.8")
	} else {
		add("2606:4700:4700::1111")
		add("2001:4860:4860::8888")
	}
	return servers
}

func socketControl(b binding) socketControlFn {
	return func(_, _ string, raw syscall.RawConn) error {
		var failure error
		err := raw.Control(func(fd uintptr) {
			failure = syscall.SetsockoptString(int(fd), syscall.SOL_SOCKET, syscall.SO_BINDTODEVICE, b.Device)
			if failure == nil {
				failure = syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_MARK, defaultMark)
			}
		})
		if err != nil {
			return err
		}
		return failure
	}
}

func boundDialer(b binding, network string, control socketControlFn) *net.Dialer {
	if control == nil {
		control = socketControl(b)
	}
	d := &net.Dialer{Timeout: 900 * time.Millisecond, Control: control}
	if strings.HasPrefix(network, "udp") {
		d.LocalAddr = &net.UDPAddr{IP: net.IP(b.Source.AsSlice())}
	} else {
		d.LocalAddr = &net.TCPAddr{IP: net.IP(b.Source.AsSlice())}
	}
	return d
}

func lookupServer(ctx context.Context, host, server string, b binding, control socketControlFn) ([]netip.Addr, error) {
	resolver := &net.Resolver{PreferGo: true, StrictErrors: true, Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
		transport := "udp"
		if strings.HasPrefix(network, "tcp") {
			transport = "tcp"
		}
		return boundDialer(b, transport, control).DialContext(ctx, transport+b.Family, server)
	}}
	// A trailing dot suppresses the host's global DNS search domains as well.
	return resolver.LookupNetIP(ctx, "ip"+b.Family, strings.TrimSuffix(host, ".")+".")
}

func lookupBound(ctx context.Context, host string, servers []string, b binding) ([]netip.Addr, error) {
	for _, server := range servers {
		attempt, cancel := context.WithTimeout(ctx, 650*time.Millisecond)
		ips, err := lookupServer(attempt, host, server, b, nil)
		cancel()
		if err == nil && len(ips) > 0 {
			return ips, nil
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
	}
	return nil, errors.New("no bound DNS response")
}

func boundHTTPClient(b binding, ips []netip.Addr, control socketControlFn) *http.Client {
	transport := &http.Transport{
		Proxy: nil, DisableKeepAlives: true, MaxConnsPerHost: 1, ResponseHeaderTimeout: 2 * time.Second,
		DialContext: func(ctx context.Context, _, addr string) (net.Conn, error) {
			_, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			var last error
			for i, ip := range ips {
				if i >= 2 {
					break
				}
				if (b.Family == "4" && !ip.Is4()) || (b.Family == "6" && (!ip.Is6() || ip.Is4In6())) {
					continue
				}
				conn, err := boundDialer(b, "tcp", control).DialContext(ctx, "tcp"+b.Family, net.JoinHostPort(ip.String(), port))
				if err == nil {
					return conn, nil
				}
				last = err
			}
			if last == nil {
				last = errors.New("no address for bound family")
			}
			return nil, last
		},
	}
	return &http.Client{Transport: transport, Timeout: probeTimeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func requestBound(ctx context.Context, url string, b binding, ips []netip.Addr) result {
	client := boundHTTPClient(b, ips, nil)
	defer client.CloseIdleConnections()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return result{Reason: "unavailable"}
	}
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("User-Agent", "TollGate-uplink-probe/1")
	response, err := client.Do(req)
	return classifyHTTP(response, err)
}

func classifyHTTP(response *http.Response, err error) result {
	if err != nil || response == nil {
		return result{Reason: "no-http"}
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		return result{Reason: "captive-or-blocked"}
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 1))
	if err != nil {
		return result{Reason: "no-http"}
	}
	if len(body) != 0 {
		return result{Reason: "captive-or-blocked"}
	}
	return result{OK: true, Reason: "ok"}
}

type limitedBuffer struct{ bytes.Buffer }

func (b *limitedBuffer) Write(data []byte) (int, error) {
	if b.Len()+len(data) > 64*1024 {
		return 0, errors.New("oversized interface response")
	}
	return b.Buffer.Write(data)
}

func interfaceStatusCommand(ctx context.Context, name string) (*exec.Cmd, error) {
	switch name {
	case "wan", "wwan", "wan6", "wwan6":
	default:
		return nil, errors.New("unsupported interface")
	}
	return exec.CommandContext(ctx, "/bin/ubus", "call", "network.interface."+name, "status"), nil
}

func readInterfaceStatus(ctx context.Context, name string) (interfaceStatus, error) {
	var status interfaceStatus
	cmd, err := interfaceStatusCommand(ctx, name)
	if err != nil {
		return status, err
	}
	var out limitedBuffer
	cmd.Stdout = &out
	cmd.Stderr = io.Discard
	if err := cmd.Run(); err != nil {
		return status, err
	}
	if err := json.Unmarshal(out.Bytes(), &status); err != nil {
		return status, err
	}
	return status, nil
}

func writeState(dir string, opt options, r result, now time.Time) error {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	info, err := os.Lstat(dir)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0022 != 0 {
		return errors.New("unsafe state directory")
	}
	if stat, ok := info.Sys().(*syscall.Stat_t); !ok || int(stat.Uid) != os.Geteuid() {
		return errors.New("state directory owner mismatch")
	}
	data, err := json.Marshal(struct {
		result
		Interface string `json:"interface"`
		Target    int    `json:"target"`
		CheckedAt int64  `json:"checked_at"`
	}{r, opt.Interface, opt.Target, now.Unix()})
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".probe-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(append(data, '\n')); err != nil {
		f.Close()
		return err
	}
	if err = f.Chmod(0644); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), filepath.Join(dir, fmt.Sprintf("%s-%s.json", opt.Interface, strconv.Itoa(opt.Target))))
}
