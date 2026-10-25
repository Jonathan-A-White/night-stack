package scene

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

func TestParseLevel(t *testing.T) {
	good := map[string]int{"Off": 0, "off": 0, "On": 100, " ON ": 100, "35%": 35, "100%": 100, "15%": 15, "0%": 0}
	for in, want := range good {
		got, err := ParseLevel(in)
		if err != nil || got != want {
			t.Errorf("ParseLevel(%q) = %d, %v; want %d", in, got, err, want)
		}
	}
	for _, in := range []string{"", "35", "101%", "-5%", "abc", "35 %%", "half", "3.5%"} {
		if _, err := ParseLevel(in); err == nil {
			t.Errorf("ParseLevel(%q) accepted", in)
		}
	}
}

func TestDefaultHas27ParsableLights(t *testing.T) {
	ls := Default()
	if len(ls) != 27 {
		t.Fatalf("%d lights, want 27", len(ls))
	}
	for _, l := range ls {
		if _, err := ParseLevel(l.Level); err != nil {
			t.Errorf("%s: %v", l.Name, err)
		}
	}
}

// The seed step is the church's source of truth for the Sunday levels; this
// test reads it from the app's source so levels.json cannot drift from it.
func TestLevelsJSONMatchesRoutineSeed(t *testing.T) {
	raw, err := os.ReadFile("../../../src/services/routineSeeds.ts")
	if err != nil {
		t.Fatal(err)
	}
	src := string(raw)
	step := strings.Index(src, "House light levels (Lutron on Cased iPad)")
	if step < 0 {
		t.Fatal("seed step not found")
	}
	src = src[step:]
	start := strings.Index(src, "Set each slider to:")
	end := strings.Index(src, "secretNames")
	if start < 0 || end < start {
		t.Fatal("seed step markers not found")
	}
	body := src[start:end]
	body = body[strings.Index(body, "\n")+1:] // lines after 'Set each slider to:'
	re := regexp.MustCompile(`^\s*'(.+?)(?:\\n)?'`)
	var want []Light
	for _, line := range strings.Split(body, "\n") {
		m := re.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		name, level, ok := strings.Cut(m[1], " – ")
		if !ok {
			t.Fatalf("no en dash in %q", m[1])
		}
		want = append(want, Light{Name: name, Level: level})
	}
	got := Default()
	if len(want) != 27 {
		t.Fatalf("parsed %d lights from the seed, want 27", len(want))
	}
	if len(got) != len(want) {
		t.Fatalf("levels.json has %d lights, the seed has %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("light %d: levels.json %+v, seed %+v", i+1, got[i], want[i])
		}
	}
}

func TestWithOverrides(t *testing.T) {
	ls := []Light{{"Left wall spots", "Off"}, {"Chandelier", "35%"}}
	got := WithOverrides(ls, map[string]string{"chandelier": "50%", "Nothing": "On"})
	if got[0].Level != "Off" || got[1].Level != "50%" {
		t.Fatalf("got %+v", got)
	}
	if ls[1].Level != "35%" {
		t.Fatal("input slice was changed")
	}
}
