package lip

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func serve(t *testing.T, path, body string, status int) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != path {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(status)
		w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return strings.TrimPrefix(srv.URL, "http://")
}

func TestFetchOutputs(t *testing.T) {
	xml, err := os.ReadFile("testdata/DbXmlInfo.xml")
	if err != nil {
		t.Fatal(err)
	}
	addr := serve(t, "/DbXmlInfo.xml", string(xml), 200)
	outs, err := FetchOutputs(context.Background(), nil, addr)
	if err != nil {
		t.Fatalf("FetchOutputs: %v", err)
	}
	want := []Output{
		{11, "Left Front Track Row 1", "Main Building / Equipment Room", "INC"},
		{12, "Left Wall Spots", "Main Building / Equipment Room", "INC"},
		{13, "Cross Chandelier", "Main Building / Equipment Room", "INC"},
		{14, "Unknown 4", "Main Building / Equipment Room", "INC"},
		{15, "Stage Fan", "Main Building / Equipment Room", "NON_DIM"},
		{21, "Lobby Pendants", "Main Building / Lobby", "INC"},
	}
	if len(outs) != len(want) {
		t.Fatalf("got %d outputs, want %d: %+v", len(outs), len(want), outs)
	}
	for i := range want {
		if outs[i] != want[i] {
			t.Errorf("output %d = %+v, want %+v", i, outs[i], want[i])
		}
	}
}

func TestFetchOutputsNotXML(t *testing.T) {
	addr := serve(t, "/DbXmlInfo.xml", "<html><body>Router login</body></html>", 200)
	_, err := FetchOutputs(context.Background(), nil, addr)
	if err == nil || !strings.Contains(err.Error(), "DbXmlInfo") {
		t.Fatalf("want a clear DbXmlInfo error, got %v", err)
	}
	addr = serve(t, "/DbXmlInfo.xml", "this is not xml at all", 200)
	if _, err := FetchOutputs(context.Background(), nil, addr); err == nil || !strings.Contains(err.Error(), "DbXmlInfo") {
		t.Fatalf("want a clear DbXmlInfo error, got %v", err)
	}
}

func TestFetchOutputsHTTPError(t *testing.T) {
	addr := serve(t, "/other", "x", 200) // the path under test 404s
	_, err := FetchOutputs(context.Background(), nil, addr)
	if err == nil || !strings.Contains(err.Error(), "404") {
		t.Fatalf("want a 404 error, got %v", err)
	}
}

func TestFetchOutputsNothingListening(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	addr := strings.TrimPrefix(srv.URL, "http://")
	srv.Close()
	if _, err := FetchOutputs(context.Background(), nil, addr); err == nil {
		t.Fatal("want a connection error")
	}
}
