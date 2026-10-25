// Package server is the page the iPad opens: one button that sets the Sunday
// lights, each light read back, a list of the lights, and a setup form.
package server

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/config"
	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/lip"
	"github.com/Jonathan-A-White/night-stack/tools/sunday-lights/scene"
)

//go:embed page.html
var pageHTML string

var pages = template.Must(template.New("page").Parse(pageHTML))

// Port is where the page is served unless told otherwise.
const Port = 8777

// RunTimeout bounds one run of the scene.
const RunTimeout = 2 * time.Minute

const busyMessage = "Already setting the lights"

// Options is what a Server needs from outside; tests hand it fakes.
type Options struct {
	Config config.Config
	Lights []scene.Light // the Sunday levels; Config.LevelOverrides are applied over them
	Fetch  func(ctx context.Context, address string) ([]lip.Output, error)
	Dial   func(ctx context.Context, address, login, password string) (*lip.Client, error)
	Save   func(config.Config) error
	Log    *log.Logger
	Now    func() time.Time
}

// Server holds the config, the matched lights and the last run.
type Server struct {
	opt Options

	mu         sync.Mutex
	cfg        config.Config
	matches    []scene.Result
	outputs    map[int]string // integration ID -> output name
	outputsErr string
	running    bool
	last       *report
}

// New makes a Server; call Refresh to match the lights to the repeater's
// outputs.
func New(opt Options) *Server {
	if opt.Log == nil {
		opt.Log = log.Default()
	}
	if opt.Now == nil {
		opt.Now = time.Now
	}
	return &Server{opt: opt, cfg: opt.Config}
}

// Refresh reads the repeater's outputs and matches the 27 lights to them. On
// failure the previous matches are kept and the error is shown on /lights.
func (s *Server) Refresh(ctx context.Context) error {
	s.mu.Lock()
	cfg := s.cfg
	s.mu.Unlock()
	matches, names, err := s.match(ctx, cfg)
	s.mu.Lock()
	defer s.mu.Unlock()
	if err != nil {
		s.outputsErr = err.Error()
		return err
	}
	s.outputsErr = ""
	s.matches, s.outputs = matches, names
	return nil
}

func (s *Server) match(ctx context.Context, cfg config.Config) ([]scene.Result, map[int]string, error) {
	outs, err := s.opt.Fetch(ctx, cfg.Address)
	if err != nil {
		return nil, nil, err
	}
	names := make(map[int]string, len(outs))
	for _, o := range outs {
		names[o.IntegrationID] = o.Name
	}
	return scene.Match(scene.WithOverrides(s.opt.Lights, cfg.LevelOverrides), outs, cfg.Picks), names, nil
}

// Handler is the whole site. Every response carries Cache-Control: no-store,
// and each request is logged by method, path and status only.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", s.handleIndex)
	mux.HandleFunc("POST /run", s.handleRun)
	mux.HandleFunc("GET /lights", s.handleLights)
	mux.HandleFunc("GET /setup", s.handleSetupForm)
	mux.HandleFunc("POST /setup", s.handleSetupSave)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		rec := &statusRecorder{ResponseWriter: w, status: 200}
		mux.ServeHTTP(rec, r)
		s.opt.Log.Printf("%s %s -> %d", r.Method, r.URL.Path, rec.status)
	})
}

// Serve answers on ln until ctx ends.
func (s *Server) Serve(ctx context.Context, ln net.Listener) error {
	srv := &http.Server{Handler: s.Handler(), ReadHeaderTimeout: 10 * time.Second}
	done := make(chan struct{})
	go func() {
		defer close(done)
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(sctx)
	}()
	err := srv.Serve(ln)
	if errors.Is(err, http.ErrServerClosed) {
		<-done
		return nil
	}
	return err
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// ---- the last run

type report struct {
	Results    []Result `json:"results"`
	FinishedAt string   `json:"finishedAt"`
}

type resultRow struct {
	Name, Wanted, Read, Reason string
	OK                         bool
}

type reportView struct {
	FinishedAt  string
	Good, Total int
	Rows        []resultRow
}

func (rp *report) view() *reportView {
	if rp == nil {
		return nil
	}
	v := &reportView{FinishedAt: rp.FinishedAt, Total: len(rp.Results)}
	for _, r := range rp.Results {
		row := resultRow{Name: r.Name, Wanted: fmt.Sprintf("%d%%", r.Wanted), Read: "nothing", Reason: r.Reason, OK: r.OK}
		if r.Read != nil {
			row.Read = trim(*r.Read) + "%"
		}
		if r.OK {
			v.Good++
		}
		v.Rows = append(v.Rows, row)
	}
	return v
}

// ---- handlers

type indexData struct {
	Status string
	Error  bool
	Run    *reportView
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	last := s.last
	s.mu.Unlock()
	s.render(w, http.StatusOK, "index", indexData{Run: last.view()})
}

func (s *Server) handleRun(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		s.replyRun(w, r, http.StatusConflict, busyMessage)
		return
	}
	s.running = true
	cfg := s.cfg
	matches := s.matches
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.running = false
		s.mu.Unlock()
	}()

	// The iPad going to sleep must not cut a run off half way.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), RunTimeout)
	defer cancel()
	if matches == nil {
		if err := s.Refresh(ctx); err != nil {
			s.replyRun(w, r, http.StatusBadGateway, "Could not read the repeater's list of lights. Open Setup to check its address. ("+err.Error()+")")
			return
		}
		s.mu.Lock()
		matches = s.matches
		s.mu.Unlock()
	}
	client, err := s.opt.Dial(ctx, cfg.Address, cfg.Login, cfg.Password)
	if err != nil {
		s.replyRun(w, r, http.StatusBadGateway, dialMessage(err))
		return
	}
	defer client.Close()
	rp := &report{Results: RunScene(ctx, client, matches)}
	rp.FinishedAt = s.opt.Now().Format("3:04:05 PM")
	s.mu.Lock()
	s.last = rp
	s.mu.Unlock()

	if wantsJSON(r) {
		writeJSON(w, http.StatusOK, rp)
		return
	}
	s.render(w, http.StatusOK, "index", indexData{Run: rp.view()})
}

func (s *Server) replyRun(w http.ResponseWriter, r *http.Request, code int, msg string) {
	if wantsJSON(r) {
		writeJSON(w, code, map[string]string{"error": msg})
		return
	}
	s.mu.Lock()
	last := s.last
	s.mu.Unlock()
	s.render(w, code, "index", indexData{Status: msg, Error: true, Run: last.view()})
}

func dialMessage(err error) string {
	if errors.Is(err, lip.ErrBadLogin) {
		return "The repeater refused the saved login or password. Open Setup to enter them again."
	}
	return "Could not reach the repeater: " + err.Error()
}

type lightRow struct {
	Name, Level, Output, Suggestions string
	ID                               int
	OK                               bool
}

type lightsData struct {
	Matched, Total int
	Rows           []lightRow
	Error          string
}

func (s *Server) handleLights(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	matches, names, errMsg := s.matches, s.outputs, s.outputsErr
	s.mu.Unlock()
	if wantsJSON(r) {
		type light struct {
			Name        string   `json:"name"`
			Level       string   `json:"level"`
			Output      string   `json:"output,omitempty"`
			OutputID    int      `json:"outputId,omitempty"`
			Suggestions []string `json:"suggestions,omitempty"`
		}
		out := struct {
			Matched   []light `json:"matched"`
			Unmatched []light `json:"unmatched"`
			Error     string  `json:"error,omitempty"`
		}{Matched: []light{}, Unmatched: []light{}, Error: errMsg}
		for _, m := range matches {
			l := light{Name: m.Light.Name, Level: m.Light.Level}
			if m.Matched {
				l.OutputID = m.OutputID
				out.Matched = append(out.Matched, l)
			} else {
				for _, o := range m.Suggestions {
					l.Suggestions = append(l.Suggestions, o.Name)
				}
				out.Unmatched = append(out.Unmatched, l)
			}
		}
		writeJSON(w, http.StatusOK, out)
		return
	}
	d := lightsData{Total: len(matches), Error: errMsg}
	for _, m := range matches {
		row := lightRow{Name: m.Light.Name, Level: m.Light.Level, OK: m.Matched}
		if m.Matched {
			d.Matched++
			row.ID = m.OutputID
			row.Output = names[m.OutputID]
		} else {
			var names []string
			for _, o := range m.Suggestions {
				names = append(names, o.Name)
			}
			row.Suggestions = strings.Join(names, ", ")
		}
		d.Rows = append(d.Rows, row)
	}
	s.render(w, http.StatusOK, "lights", d)
}

type setupData struct {
	Address, Login string
	Message        string
	Error          bool
}

func (s *Server) handleSetupForm(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	d := setupData{Address: s.cfg.Address, Login: s.cfg.Login}
	s.mu.Unlock()
	s.render(w, http.StatusOK, "setup", d)
}

func (s *Server) handleSetupSave(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "unreadable form", http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	cfg := s.cfg
	running := s.running
	s.mu.Unlock()
	if running {
		s.render(w, http.StatusConflict, "setup", setupData{Address: cfg.Address, Login: cfg.Login, Message: busyMessage, Error: true})
		return
	}
	next := cfg
	next.Address = strings.TrimSpace(r.PostFormValue("address"))
	next.Login = strings.TrimSpace(r.PostFormValue("login"))
	if pw := r.PostFormValue("password"); pw != "" {
		next.Password = pw
	}
	fail := func(code int, msg string) {
		s.render(w, code, "setup", setupData{Address: next.Address, Login: next.Login, Message: msg, Error: true})
	}
	if next.Address == "" || next.Login == "" {
		fail(http.StatusUnprocessableEntity, "The address and the login cannot be empty.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	matches, names, err := s.match(ctx, next)
	if err != nil {
		fail(http.StatusBadGateway, "Could not read the repeater's list of lights at that address. ("+err.Error()+")")
		return
	}
	client, err := s.opt.Dial(ctx, next.Address, next.Login, next.Password)
	if err != nil {
		if errors.Is(err, lip.ErrBadLogin) {
			fail(http.StatusUnprocessableEntity, "The repeater refused that login or password. Nothing was changed.")
		} else {
			fail(http.StatusBadGateway, dialMessage(err))
		}
		return
	}
	client.Close()
	if err := s.opt.Save(next); err != nil {
		fail(http.StatusInternalServerError, "Could not save the settings: "+err.Error())
		return
	}
	good := 0
	for _, m := range matches {
		if m.Matched {
			good++
		}
	}
	s.mu.Lock()
	s.cfg, s.matches, s.outputs, s.outputsErr = next, matches, names, ""
	s.mu.Unlock()
	s.render(w, http.StatusOK, "setup", setupData{Address: next.Address, Login: next.Login,
		Message: fmt.Sprintf("Saved. %d of %d lights matched.", good, len(matches))})
}

// ---- output

func wantsJSON(r *http.Request) bool {
	return strings.Contains(r.Header.Get("Accept"), "application/json")
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func (s *Server) render(w http.ResponseWriter, code int, name string, data any) {
	var sb strings.Builder
	if err := pages.ExecuteTemplate(&sb, name, data); err != nil {
		s.opt.Log.Printf("rendering %s: %v", name, err)
		http.Error(w, "page error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(code)
	w.Write([]byte(sb.String()))
}
