package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/config"
	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/internal/fakelip"
	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/lip"
	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/scene"
)

const fakePassword = "hunter2-fake-password"

type fixture struct {
	t        *testing.T
	rig      *fakelip.Rig
	srv      *Server
	ts       *httptest.Server
	logs     *bytes.Buffer
	cfgPath  string
	dialGate func() // called at the start of every Dial; tests replace it
	mu       sync.Mutex
	bodies   []string // every response body seen through get and post
}

func newFixture(t *testing.T, outs []lip.Output) *fixture {
	t.Helper()
	f := &fixture{t: t, logs: &bytes.Buffer{}, cfgPath: filepath.Join(t.TempDir(), "sunday-lights", "config.json")}
	f.rig = fakelip.NewRig(t, "church", fakePassword, outs)
	f.dialGate = func() {}
	cfg := config.Config{Address: fakelip.Address, Login: "church", Password: fakePassword,
		Picks: map[string]int{}, LevelOverrides: map[string]string{}}
	f.srv = New(Options{
		Config: cfg,
		Lights: scene.Default(),
		Fetch:  f.rig.Fetch,
		Dial: func(ctx context.Context, address, login, password string) (*lip.Client, error) {
			f.dialGate()
			return f.rig.Dial(ctx, address, login, password)
		},
		Save: func(c config.Config) error { return c.SaveTo(f.cfgPath) },
		Log:  log.New(f.logs, "", 0),
		Now:  func() time.Time { return time.Date(2026, 10, 25, 9, 30, 15, 0, time.UTC) },
	})
	if err := f.srv.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	f.ts = httptest.NewServer(f.srv.Handler())
	t.Cleanup(f.ts.Close)
	return f
}

func (f *fixture) do(method, path string, form url.Values, accept string) (int, http.Header, string) {
	f.t.Helper()
	var body io.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	}
	req, err := http.NewRequest(method, f.ts.URL+path, body)
	if err != nil {
		f.t.Fatal(err)
	}
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		f.t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	f.mu.Lock()
	f.bodies = append(f.bodies, string(b))
	f.mu.Unlock()
	if cc := resp.Header.Get("Cache-Control"); cc != "no-store" {
		f.t.Errorf("%s %s: Cache-Control = %q, want no-store", method, path, cc)
	}
	return resp.StatusCode, resp.Header, string(b)
}

func (f *fixture) get(path string) (int, string) {
	f.t.Helper()
	code, _, body := f.do("GET", path, nil, "")
	return code, body
}

type runResponse struct {
	Results    []Result `json:"results"`
	FinishedAt string   `json:"finishedAt"`
	Error      string   `json:"error"`
}

func TestIndexHoldsTheButton(t *testing.T) {
	f := newFixture(t, sundayOutputs())
	code, body := f.get("/")
	if code != 200 {
		t.Fatalf("GET / = %d", code)
	}
	for _, want := range []string{"Brookfield Church · Sunday lights", "Set Sunday lights", `name="viewport"`, "64px", "width: 100%"} {
		if !strings.Contains(body, want) {
			t.Errorf("page lacks %q", want)
		}
	}
	if n := strings.Count(body, "<button"); n != 1 {
		t.Errorf("%d buttons, want 1", n)
	}
	btn := strings.Index(body, "<button")
	for _, later := range []string{`href="/setup"`, `href="/lights"`} {
		if i := strings.Index(body, later); i < btn {
			t.Errorf("%s (at %d) is not below the button (at %d)", later, i, btn)
		}
	}
	for _, banned := range []string{"<script src", "https://", "http://", "@import", "fonts.googleapis"} {
		if strings.Contains(body, banned) {
			t.Errorf("page contains %q", banned)
		}
	}
	if !strings.Contains(body, "<form") {
		t.Errorf("the button is not in a form, so it fails without JavaScript")
	}
}

func TestRunReturnsResultsAndMovesTheLights(t *testing.T) {
	f := newFixture(t, sundayOutputs())
	code, _, body := f.do("POST", "/run", nil, "application/json")
	if code != 200 {
		t.Fatalf("POST /run = %d: %s", code, body)
	}
	var rr runResponse
	if err := json.Unmarshal([]byte(body), &rr); err != nil {
		t.Fatalf("%v: %s", err, body)
	}
	if len(rr.Results) != 27 {
		t.Fatalf("%d results", len(rr.Results))
	}
	for _, r := range rr.Results {
		if !r.OK {
			t.Errorf("%+v", r)
		}
	}
	if l, ok := f.rig.Level(101); !ok || l != "35" {
		t.Errorf("output 101 level = %q, %v; want 35", l, ok)
	}
	if l, _ := f.rig.Level(105); l != "0" {
		t.Errorf("output 105 (Off) level = %q, want 0", l)
	}
	if !strings.Contains(rr.FinishedAt, "9:30:15") {
		t.Errorf("finishedAt = %q", rr.FinishedAt)
	}

	// The page after a run shows each light, a tick and the time.
	_, page := f.get("/")
	for _, want := range []string{"Left front track row 1", "35%", "✓", "9:30:15"} {
		if !strings.Contains(page, want) {
			t.Errorf("page after a run lacks %q", want)
		}
	}
	if strings.Contains(page, "✗") {
		t.Errorf("page after a good run has a cross")
	}
}

func TestRunWithoutJavaScriptShowsThePage(t *testing.T) {
	f := newFixture(t, sundayOutputs())
	code, hdr, body := f.do("POST", "/run", nil, "text/html")
	if code != 200 || !strings.HasPrefix(hdr.Get("Content-Type"), "text/html") {
		t.Fatalf("%d %s", code, hdr.Get("Content-Type"))
	}
	if !strings.Contains(body, "Set Sunday lights") || !strings.Contains(body, "Left front track row 1") {
		t.Errorf("page lacks the button or the results")
	}
}

func TestRunShowsACrossForAFailingLight(t *testing.T) {
	f := newFixture(t, sundayOutputs())
	f.rig.BadRead[103] = true
	_, _, body := f.do("POST", "/run", nil, "application/json")
	var rr runResponse
	json.Unmarshal([]byte(body), &rr)
	if rr.Results[2].OK || !rr.Results[0].OK {
		t.Errorf("%+v", rr.Results[:3])
	}
	_, page := f.get("/")
	if !strings.Contains(page, "✗") {
		t.Errorf("no cross on the page")
	}
}

func TestConcurrentRunIsRefused(t *testing.T) {
	f := newFixture(t, sundayOutputs())
	entered := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	f.dialGate = func() { once.Do(func() { close(entered) }); <-release }

	first := make(chan int, 1)
	go func() {
		code, _, _ := f.do("POST", "/run", nil, "application/json")
		first <- code
	}()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("the first run never started")
	}
	code, _, body := f.do("POST", "/run", nil, "application/json")
	if code != http.StatusConflict || !strings.Contains(body, "Already setting the lights") {
		t.Errorf("second POST = %d %q", code, body)
	}
	close(release)
	if c := <-first; c != 200 {
		t.Errorf("first run = %d", c)
	}
	// and a run after the first has finished is accepted again
	if code, _, _ := f.do("POST", "/run", nil, "application/json"); code != 200 {
		t.Errorf("third run = %d", code)
	}
}

func TestLightsListsMatchedAndUnmatched(t *testing.T) {
	outs := sundayOutputs()
	outs[4].Name = "Left wall spotlights"
	f := newFixture(t, outs)
	code, body := f.get("/lights")
	if code != 200 {
		t.Fatalf("GET /lights = %d", code)
	}
	for _, want := range []string{"Left front track row 1", "Left wall spots", "Left wall spotlights", "26 of 27"} {
		if !strings.Contains(body, want) {
			t.Errorf("/lights lacks %q", want)
		}
	}
	_, _, js := f.do("GET", "/lights", nil, "application/json")
	var lr struct {
		Matched   []map[string]any `json:"matched"`
		Unmatched []map[string]any `json:"unmatched"`
	}
	if err := json.Unmarshal([]byte(js), &lr); err != nil || len(lr.Matched) != 26 || len(lr.Unmatched) != 1 {
		t.Errorf("json lights: %v, %d matched, %d unmatched", err, len(lr.Matched), len(lr.Unmatched))
	}
}

func TestSetupPageNeverShowsThePassword(t *testing.T) {
	f := newFixture(t, sundayOutputs())
	code, body := f.get("/setup")
	if code != 200 {
		t.Fatalf("GET /setup = %d", code)
	}
	if strings.Contains(body, fakePassword) {
		t.Errorf("GET /setup shows the password")
	}
	for _, want := range []string{fakelip.Address, "church", `type="password"`} {
		if !strings.Contains(body, want) {
			t.Errorf("setup page lacks %q", want)
		}
	}
	i := strings.Index(body, `type="password"`)
	tag := body[strings.LastIndex(body[:i], "<") : i+strings.Index(body[i:], ">")]
	if strings.Contains(tag, "value=") {
		t.Errorf("the password input has a value: %s", tag)
	}
}

func TestSetupPostSavesAt0600AndRematches(t *testing.T) {
	f := newFixture(t, sundayOutputs())
	form := url.Values{"address": {fakelip.Address}, "login": {"church"}, "password": {fakePassword}}
	code, _, body := f.do("POST", "/setup", form, "")
	if code != 200 {
		t.Fatalf("POST /setup = %d: %s", code, body)
	}
	if !strings.Contains(body, "27 of 27") {
		t.Errorf("no match count after setup: %s", body)
	}
	saved, err := config.LoadFrom(f.cfgPath)
	if err != nil || saved.Password != fakePassword || saved.Login != "church" {
		t.Fatalf("saved config %v, %v", saved, err)
	}
	if runtime.GOOS != "windows" {
		st, err := os.Stat(f.cfgPath)
		if err != nil {
			t.Fatal(err)
		}
		if st.Mode().Perm() != 0o600 {
			t.Errorf("config mode %v, want 0600", st.Mode().Perm())
		}
	}
}

func TestSetupPostBlankPasswordKeepsTheOne(t *testing.T) {
	f := newFixture(t, sundayOutputs())
	form := url.Values{"address": {fakelip.Address}, "login": {"church"}, "password": {""}}
	if code, _, body := f.do("POST", "/setup", form, ""); code != 200 {
		t.Fatalf("POST /setup = %d: %s", code, body)
	}
	saved, _ := config.LoadFrom(f.cfgPath)
	if saved.Password != fakePassword {
		t.Errorf("a blank password field replaced the password")
	}
}

func TestSetupPostRefusedLoginSavesNothing(t *testing.T) {
	f := newFixture(t, sundayOutputs())
	form := url.Values{"address": {fakelip.Address}, "login": {"church"}, "password": {"wrong-one"}}
	code, _, body := f.do("POST", "/setup", form, "")
	if code == 200 || !strings.Contains(body, "refused") {
		t.Errorf("POST /setup with a bad password = %d %q", code, body)
	}
	if strings.Contains(body, "wrong-one") {
		t.Errorf("the refused password is echoed")
	}
	if _, err := os.Stat(f.cfgPath); err == nil {
		t.Errorf("a config was saved after a refused login")
	}
	// the old login still works
	if code, _, _ := f.do("POST", "/run", nil, "application/json"); code != 200 {
		t.Errorf("run after the refusal = %d", code)
	}
}

func TestThePasswordIsInNoLogLineAndNoResponse(t *testing.T) {
	f := newFixture(t, sundayOutputs())
	f.get("/")
	f.get("/setup")
	f.do("POST", "/setup", url.Values{"address": {fakelip.Address}, "login": {"church"}, "password": {fakePassword}}, "")
	f.do("POST", "/setup", url.Values{"address": {fakelip.Address}, "login": {"church"}, "password": {"another-secret-pw"}}, "")
	f.do("POST", "/run", nil, "application/json")
	f.do("POST", "/run", nil, "")
	f.get("/lights")
	f.get("/")
	if f.logs.Len() == 0 {
		t.Error("nothing was logged at all")
	}
	for _, secret := range []string{fakePassword, "another-secret-pw"} {
		if strings.Contains(f.logs.String(), secret) {
			t.Errorf("the log holds a password:\n%s", f.logs.String())
		}
		f.mu.Lock()
		for i, b := range f.bodies {
			if strings.Contains(b, secret) {
				t.Errorf("response %d holds a password", i)
			}
		}
		f.mu.Unlock()
	}
}

func TestUnknownPathIs404(t *testing.T) {
	f := newFixture(t, sundayOutputs())
	if code, _ := f.get("/nope"); code != 404 {
		t.Errorf("GET /nope = %d", code)
	}
}
