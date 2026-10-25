package server

import (
	"context"
	"fmt"
	"math"

	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/scene"
)

// FadeSeconds is how long each light takes to reach its level.
const FadeSeconds = 2

// Output is the part of a logged-in repeater session that RunScene uses;
// *lip.Client is one.
type Output interface {
	SetOutput(ctx context.Context, id int, level, fadeSeconds float64) error
	GetOutput(ctx context.Context, id int) (float64, error)
}

// Result is what happened to one light.
type Result struct {
	Name   string   `json:"name"`
	Wanted int      `json:"wanted"` // percent, 0 to 100
	Read   *float64 `json:"read"`   // the level read back; nil when it could not be
	OK     bool     `json:"ok"`
	Reason string   `json:"reason,omitempty"` // why not OK
}

// RunScene sets every matched light to its level with
// #OUTPUT,<id>,1,<level>,2, in the order of matches, then reads each one back
// and compares. Every light has a Result, in the same order: a light with no
// matching output is a Result that is not OK and says why, and one output's
// error never stops the others.
func RunScene(ctx context.Context, client Output, matches []scene.Result) []Result {
	results := make([]Result, len(matches))
	for i, m := range matches {
		r := Result{Name: m.Light.Name}
		switch level, err := scene.ParseLevel(m.Light.Level); {
		case err != nil:
			r.Reason = err.Error()
		case !m.Matched:
			r.Wanted = level
			r.Reason = "no output in the repeater has this name"
		default:
			r.Wanted = level
			if err := client.SetOutput(ctx, m.OutputID, float64(level), FadeSeconds); err != nil {
				r.Reason = fmt.Sprintf("setting output %d: %v", m.OutputID, err)
			}
		}
		results[i] = r
	}
	for i, m := range matches {
		r := &results[i]
		if r.Reason != "" {
			continue
		}
		read, err := client.GetOutput(ctx, m.OutputID)
		if err != nil {
			r.Reason = fmt.Sprintf("reading output %d back: %v", m.OutputID, err)
			continue
		}
		r.Read = &read
		if math.Abs(read-float64(r.Wanted)) > 0.5 {
			r.Reason = fmt.Sprintf("read back %s%%, wanted %d%%", trim(read), r.Wanted)
			continue
		}
		r.OK = true
	}
	return results
}

func trim(v float64) string { return fmt.Sprintf("%.4g", v) }
