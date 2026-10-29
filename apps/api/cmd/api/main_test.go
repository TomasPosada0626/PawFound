package main

import "testing"

func TestResolvePort(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{"empty uses default", "", defaultPort},
		{"valid port kept", "9090", "9090"},
		{"non-numeric falls back", "not-a-port", defaultPort},
		{"zero falls back", "0", defaultPort},
		{"too large falls back", "70000", defaultPort},
		{"negative falls back", "-1", defaultPort},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := resolvePort(tt.raw); got != tt.want {
				t.Errorf("resolvePort(%q) = %q, want %q", tt.raw, got, tt.want)
			}
		})
	}
}
