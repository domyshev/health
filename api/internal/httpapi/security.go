package httpapi

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
)

func ClientIP(request *http.Request, trustedProxies []netip.Prefix) netip.Addr {
	peer := remoteAddress(request.RemoteAddr)
	if !peer.IsValid() || !addressInPrefixes(peer, trustedProxies) {
		return peer
	}

	var chain []netip.Addr
	for _, item := range strings.Split(request.Header.Get("X-Forwarded-For"), ",") {
		address, err := netip.ParseAddr(strings.TrimSpace(item))
		if err != nil {
			return peer
		}
		chain = append(chain, address.Unmap())
	}
	chain = append(chain, peer)
	for index := len(chain) - 1; index >= 0; index-- {
		if !addressInPrefixes(chain[index], trustedProxies) {
			return chain[index]
		}
	}
	return chain[0]
}

func OriginAllowed(origin string, allowed map[string]struct{}) bool {
	_, ok := allowed[origin]
	return ok
}

func remoteAddress(value string) netip.Addr {
	host, _, err := net.SplitHostPort(value)
	if err != nil {
		host = value
	}
	address, err := netip.ParseAddr(strings.TrimSpace(host))
	if err != nil {
		return netip.Addr{}
	}
	return address.Unmap()
}

func addressInPrefixes(address netip.Addr, prefixes []netip.Prefix) bool {
	for _, prefix := range prefixes {
		if prefix.Contains(address) {
			return true
		}
	}
	return false
}
