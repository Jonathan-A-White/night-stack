package scene

import (
	"testing"

	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/lip"
)

var outs = []lip.Output{
	{IntegrationID: 11, Name: "Left Front Track Row 1", Area: "Equipment Room"},
	{IntegrationID: 12, Name: "Left Wall Spots", Area: "Equipment Room"},
	{IntegrationID: 13, Name: "Cross Chandelier", Area: "Equipment Room"},
	{IntegrationID: 14, Name: "Unknown 4", Area: "Equipment Room"},
	{IntegrationID: 15, Name: "Altar Track Recess", Area: "Equipment Room"},
	{IntegrationID: 16, Name: "Chandelier Main", Area: "Equipment Room"},
	{IntegrationID: 17, Name: "Chandelier Rear", Area: "Equipment Room"},
	{IntegrationID: 18, Name: "Chandelier Front", Area: "Equipment Room"},
}

func find(rs []Result, name string) Result {
	for _, r := range rs {
		if r.Light.Name == name {
			return r
		}
	}
	return Result{}
}

func TestMatchExactAndNormalised(t *testing.T) {
	ls := []Light{
		{"Left Wall Spots", "Off"},        // exact
		{"Left front track row 1", "35%"}, // case differs
		{"Unknown4", "Off"},               // spacing differs
		{"Left-Wall.Spots", "Off"},        // punctuation differs
		{"Alter track recess", "100%"},    // altar/alter
	}
	rs := Match(ls, outs, nil)
	want := map[string]int{"Left Wall Spots": 12, "Left front track row 1": 11, "Unknown4": 14, "Left-Wall.Spots": 12, "Alter track recess": 15}
	for name, id := range want {
		r := find(rs, name)
		if !r.Matched || r.OutputID != id {
			t.Errorf("%s: %+v, want output %d", name, r, id)
		}
	}
	if len(rs) != len(ls) {
		t.Fatalf("%d results for %d lights", len(rs), len(ls))
	}
}

func TestMatchUsesPick(t *testing.T) {
	ls := []Light{{"Chandelier", "35%"}}
	rs := Match(ls, outs, map[string]int{"Chandelier": 17})
	if r := rs[0]; !r.Matched || r.OutputID != 17 || r.How != "pick" {
		t.Fatalf("%+v", r)
	}
}

func TestMatchExactBeatsPick(t *testing.T) {
	rs := Match([]Light{{"Cross chandelier", "100%"}}, outs, map[string]int{"Cross chandelier": 17})
	if r := rs[0]; r.OutputID != 13 || r.How != "exact" {
		t.Fatalf("%+v", r)
	}
}

func TestMatchPickForMissingOutputIsIgnored(t *testing.T) {
	rs := Match([]Light{{"Chandelier", "35%"}}, outs, map[string]int{"Chandelier": 999})
	if rs[0].Matched {
		t.Fatalf("a pick of an output that no longer exists was used: %+v", rs[0])
	}
}

func TestMatchUnmatchedSuggestsThreeNearest(t *testing.T) {
	rs := Match([]Light{{"Chandelier", "35%"}}, outs, nil)
	r := rs[0]
	if r.Matched {
		t.Fatalf("matched %+v", r)
	}
	if len(r.Suggestions) != 3 {
		t.Fatalf("%d suggestions, want 3: %+v", len(r.Suggestions), r.Suggestions)
	}
	// The three Chandelier outputs (plus "Cross Chandelier") are nearest; the
	// nearest of all is the shortest extra text.
	for _, s := range r.Suggestions {
		if s.Name == "Unknown 4" || s.Name == "Left Wall Spots" {
			t.Errorf("far name suggested: %+v", s)
		}
	}
	if r.Suggestions[0].Name != "Cross Chandelier" && r.Suggestions[0].Name != "Chandelier Main" && r.Suggestions[0].Name != "Chandelier Rear" {
		t.Errorf("first suggestion %+v", r.Suggestions[0])
	}
}

func TestMatchAmbiguousExactIsNotGuessed(t *testing.T) {
	dup := append([]lip.Output{}, outs...)
	dup = append(dup, lip.Output{IntegrationID: 40, Name: "unknown 4", Area: "Lobby"})
	r := Match([]Light{{"Unknown 4", "Off"}}, dup, nil)[0]
	if r.Matched {
		t.Fatalf("picked one of two equal names: %+v", r)
	}
	if len(r.Suggestions) < 2 {
		t.Fatalf("want both candidates suggested: %+v", r.Suggestions)
	}
}

func TestMatchWithFewerThanThreeOutputs(t *testing.T) {
	r := Match([]Light{{"Nope", "On"}}, outs[:2], nil)[0]
	if r.Matched || len(r.Suggestions) != 2 {
		t.Fatalf("%+v", r)
	}
}

func TestEditDistance(t *testing.T) {
	if d := editDistance("kitten", "sitting"); d != 3 {
		t.Fatalf("d = %d", d)
	}
	if editDistance("", "abc") != 3 || editDistance("abc", "abc") != 0 {
		t.Fatal("edge cases")
	}
}
