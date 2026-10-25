// Package scene holds the Sunday light levels and matches their names to the
// repeater's outputs.
package scene

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// Light is one house light and the level it is set to, in the words of the
// routine step it came from: "35%", "Off", "On", "100%".
type Light struct {
	Name  string `json:"name"`
	Level string `json:"level"`
}

// levels.json is the 27 lights of the "House light levels (Lutron on Cased
// iPad)" step in src/services/routineSeeds.ts, in its order; levels_test.go
// fails if the two differ.
//
//go:embed levels.json
var levelsJSON []byte

// Default returns the Sunday levels.
func Default() []Light {
	var ls []Light
	if err := json.Unmarshal(levelsJSON, &ls); err != nil {
		panic("scene: levels.json is not valid: " + err.Error())
	}
	return ls
}

// ParseLevel turns "Off" into 0, "On" into 100 and "N%" into N (0 to 100).
func ParseLevel(s string) (int, error) {
	t := strings.ToLower(strings.TrimSpace(s))
	switch t {
	case "off":
		return 0, nil
	case "on":
		return 100, nil
	}
	if n, ok := strings.CutSuffix(t, "%"); ok {
		v, err := strconv.Atoi(n)
		if err == nil && v >= 0 && v <= 100 {
			return v, nil
		}
	}
	return 0, fmt.Errorf("scene: %q is not Off, On or a percentage from 0%% to 100%%", s)
}

// WithOverrides returns a copy of lights where any light named in overrides
// (names compared as Match compares them) has the override's level instead.
func WithOverrides(lights []Light, overrides map[string]string) []Light {
	byName := make(map[string]string, len(overrides))
	for name, level := range overrides {
		byName[normalise(name)] = level
	}
	out := make([]Light, len(lights))
	for i, l := range lights {
		if level, ok := byName[normalise(l.Name)]; ok {
			l.Level = level
		}
		out[i] = l
	}
	return out
}
