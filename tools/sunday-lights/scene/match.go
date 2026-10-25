package scene

import (
	"sort"
	"strings"
	"unicode"

	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/lip"
)

// Result is what Match decided for one light.
type Result struct {
	Light    Light
	Matched  bool
	OutputID int    // set when Matched
	How      string // "exact" or "pick" when Matched

	// Suggestions, when not Matched, are the outputs whose names are nearest
	// (at most three), or the outputs that tied for an exact match.
	Suggestions []lip.Output
}

// Match decides an output for each light, in the order of lights. A light
// matches the one output whose name is the same after normalising; failing
// that, the output its name has in picks (if that output still exists);
// failing that it is left unmatched with the nearest names. Two outputs with
// the same normalised name are never guessed between.
func Match(lights []Light, outputs []lip.Output, picks map[string]int) []Result {
	byID := make(map[int]bool, len(outputs))
	byNorm := make(map[string][]lip.Output)
	for _, o := range outputs {
		byID[o.IntegrationID] = true
		n := normalise(o.Name)
		byNorm[n] = append(byNorm[n], o)
	}
	pickByNorm := make(map[string]int, len(picks))
	for name, id := range picks {
		pickByNorm[normalise(name)] = id
	}
	results := make([]Result, 0, len(lights))
	for _, l := range lights {
		r := Result{Light: l}
		n := normalise(l.Name)
		switch cands := byNorm[n]; {
		case len(cands) == 1:
			r.Matched, r.OutputID, r.How = true, cands[0].IntegrationID, "exact"
		case len(cands) > 1:
			r.Suggestions = cands
		default:
			if id, ok := pickByNorm[n]; ok && byID[id] {
				r.Matched, r.OutputID, r.How = true, id, "pick"
			} else {
				r.Suggestions = nearest(n, outputs, 3)
			}
		}
		results = append(results, r)
	}
	return results
}

// normalise lower-cases a name and drops everything but letters and digits,
// and reads "alter" as "altar" (the church's list spells it both ways).
func normalise(s string) string {
	var sb strings.Builder
	for _, r := range strings.ToLower(s) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			sb.WriteRune(r)
		}
	}
	return strings.ReplaceAll(sb.String(), "alter", "altar")
}

func nearest(norm string, outputs []lip.Output, n int) []lip.Output {
	type scored struct {
		o lip.Output
		d int
	}
	all := make([]scored, len(outputs))
	for i, o := range outputs {
		all[i] = scored{o, editDistance(norm, normalise(o.Name))}
	}
	sort.SliceStable(all, func(i, j int) bool {
		if all[i].d != all[j].d {
			return all[i].d < all[j].d
		}
		return all[i].o.IntegrationID < all[j].o.IntegrationID
	})
	if len(all) > n {
		all = all[:n]
	}
	out := make([]lip.Output, len(all))
	for i, s := range all {
		out[i] = s.o
	}
	return out
}

// editDistance is the Levenshtein distance between a and b, counted in runes.
func editDistance(a, b string) int {
	ra, rb := []rune(a), []rune(b)
	prev := make([]int, len(rb)+1)
	cur := make([]int, len(rb)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(ra); i++ {
		cur[0] = i
		for j := 1; j <= len(rb); j++ {
			cost := 1
			if ra[i-1] == rb[j-1] {
				cost = 0
			}
			cur[j] = min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost)
		}
		prev, cur = cur, prev
	}
	return prev[len(rb)]
}
