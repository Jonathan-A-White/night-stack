package server

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/internal/fakelip"
	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/lip"
	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/scene"
)

// sundayOutputs names an output after each Sunday light, ids from 101.
func sundayOutputs() []lip.Output {
	var outs []lip.Output
	for i, l := range scene.Default() {
		outs = append(outs, lip.Output{IntegrationID: 101 + i, Name: l.Name})
	}
	return outs
}

func dial(t *testing.T, rig *fakelip.Rig) *lip.Client {
	t.Helper()
	c, err := rig.Dial(context.Background(), fakelip.Address, "lutron", "integration")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })
	return c
}

func TestRunSceneSetsInOrderAndReadsBack(t *testing.T) {
	outs := sundayOutputs()
	rig := fakelip.NewRig(t, "lutron", "integration", outs)
	lights := scene.Default()
	matches := scene.Match(lights, outs, nil)

	results := RunScene(context.Background(), dial(t, rig), matches)

	if len(results) != 27 {
		t.Fatalf("%d results, want 27", len(results))
	}
	for i, r := range results {
		want, _ := scene.ParseLevel(lights[i].Level)
		if r.Name != lights[i].Name || r.Wanted != want || !r.OK || r.Read == nil || *r.Read != float64(want) {
			t.Errorf("result %d: %+v, want %s at %d and OK", i, r, lights[i].Name, want)
		}
	}
	var sets []string
	for _, c := range rig.Commands() {
		if strings.HasPrefix(c, "#OUTPUT,") {
			sets = append(sets, c)
		}
	}
	if len(sets) != 27 {
		t.Fatalf("%d sets", len(sets))
	}
	for i, l := range lights {
		want, _ := scene.ParseLevel(l.Level)
		if exp := fmt.Sprintf("#OUTPUT,%d,1,%d,2", 101+i, want); sets[i] != exp {
			t.Errorf("set %d = %q, want %q", i, sets[i], exp)
		}
	}
	cmds := rig.Commands()
	firstRead := -1
	for i, c := range cmds {
		if strings.HasPrefix(c, "?OUTPUT,") {
			firstRead = i
			break
		}
	}
	if firstRead != 27 {
		t.Errorf("first read at command %d, want 27 (after all the sets)", firstRead)
	}
}

func TestRunSceneOneFailingOutputDoesNotStopTheRest(t *testing.T) {
	outs := sundayOutputs()
	rig := fakelip.NewRig(t, "lutron", "integration", outs)
	rig.BadRead[103] = true
	matches := scene.Match(scene.Default(), outs, nil)

	results := RunScene(context.Background(), dial(t, rig), matches)

	bad := 0
	for i, r := range results {
		if i == 2 {
			if r.OK || r.Reason == "" || r.Read != nil {
				t.Errorf("failing output: %+v", r)
			}
			bad++
			continue
		}
		if !r.OK {
			t.Errorf("result %d (%s) not OK: %+v", i, r.Name, r)
		}
	}
	if bad != 1 || len(results) != 27 {
		t.Errorf("bad=%d len=%d", bad, len(results))
	}
}

func TestRunSceneUnmatchedLightIsAFailureWithAReason(t *testing.T) {
	outs := sundayOutputs()
	outs[4].Name = "Something else"
	rig := fakelip.NewRig(t, "lutron", "integration", outs)
	matches := scene.Match(scene.Default(), outs, nil)

	results := RunScene(context.Background(), dial(t, rig), matches)

	if r := results[4]; r.OK || r.Name != "Left wall spots" || !strings.Contains(r.Reason, "no output") {
		t.Errorf("unmatched result: %+v", r)
	}
	if !results[5].OK {
		t.Errorf("the light after the unmatched one failed: %+v", results[5])
	}
	for _, c := range rig.Commands() {
		if strings.HasPrefix(c, "#OUTPUT,105,") {
			t.Errorf("an unmatched light was set: %s", c)
		}
	}
}

func TestRunSceneBadLevelNameFails(t *testing.T) {
	outs := sundayOutputs()
	rig := fakelip.NewRig(t, "lutron", "integration", outs)
	lights := []scene.Light{{Name: "Chandelier", Level: "dim-ish"}, {Name: "Recess back", Level: "15%"}}
	results := RunScene(context.Background(), dial(t, rig), scene.Match(lights, outs, nil))
	if results[0].OK || results[0].Reason == "" || !results[1].OK {
		t.Errorf("%+v", results)
	}
}
