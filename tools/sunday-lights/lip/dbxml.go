package lip

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// Output is one dimmable or switched load in the repeater's project.
type Output struct {
	IntegrationID int
	Name          string
	Area          string // the enclosing Area names, outermost first, joined by " / "
	OutputType    string
}

const maxDbXmlBytes = 16 << 20

type xmlArea struct {
	Name    string      `xml:"Name,attr"`
	Outputs []xmlOutput `xml:"Outputs>Output"`
	Areas   []xmlArea   `xml:"Areas>Area"`
}

type xmlOutput struct {
	Name          string `xml:"Name,attr"`
	IntegrationID int    `xml:"IntegrationID,attr"`
	OutputType    string `xml:"OutputType,attr"`
}

type xmlProject struct {
	Areas []xmlArea `xml:"Areas>Area"`
}

// FetchOutputs GETs http://<repeaterAddress>/DbXmlInfo.xml and returns every
// output in it, in document order. The address is used as given (a host, or
// host:port); a nil client gets one with a 5 s timeout.
func FetchOutputs(ctx context.Context, client *http.Client, repeaterAddress string) ([]Output, error) {
	if client == nil {
		client = &http.Client{Timeout: ReadTimeout}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+repeaterAddress+"/DbXmlInfo.xml", nil)
	if err != nil {
		return nil, fmt.Errorf("lip: DbXmlInfo.xml request: %w", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("lip: fetching DbXmlInfo.xml from %s: %w", repeaterAddress, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("lip: DbXmlInfo.xml from %s: HTTP %d", repeaterAddress, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxDbXmlBytes))
	if err != nil {
		return nil, fmt.Errorf("lip: reading DbXmlInfo.xml from %s: %w", repeaterAddress, err)
	}
	outs, err := ParseOutputs(body)
	if err != nil {
		return nil, fmt.Errorf("lip: DbXmlInfo.xml from %s: %w", repeaterAddress, err)
	}
	return outs, nil
}

// ParseOutputs reads the outputs out of a DbXmlInfo.xml document.
func ParseOutputs(doc []byte) ([]Output, error) {
	var p xmlProject
	dec := xml.NewDecoder(strings.NewReader(string(doc)))
	dec.CharsetReader = func(label string, in io.Reader) (io.Reader, error) { return in, nil }
	if err := dec.Decode(&p); err != nil {
		return nil, fmt.Errorf("the answer is not a DbXmlInfo.xml document (%v)", err)
	}
	if len(p.Areas) == 0 {
		return nil, errors.New("the answer is not a DbXmlInfo.xml document (no Areas in it)")
	}
	var outs []Output
	var walk func(a xmlArea, path []string)
	walk = func(a xmlArea, path []string) {
		path = append(path[:len(path):len(path)], a.Name)
		for _, o := range a.Outputs {
			outs = append(outs, Output{o.IntegrationID, o.Name, strings.Join(path, " / "), o.OutputType})
		}
		for _, sub := range a.Areas {
			walk(sub, path)
		}
	}
	for _, a := range p.Areas {
		walk(a, nil)
	}
	return outs, nil
}
