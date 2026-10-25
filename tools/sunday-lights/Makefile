# Build and test the Sunday lights program. Needs Go 1.22 or later.
#
#   make test    go vet and go test
#   make build   the three programs, in dist/
#   make clean   remove dist/

DIST := dist
BUILD := CGO_ENABLED=0 go build -trimpath -ldflags "-s -w"
CMD := ./cmd/sunday-lights

.PHONY: test build clean

test:
	go vet ./...
	go test ./...

build: $(DIST)/sunday-lights-mac-apple-silicon $(DIST)/sunday-lights-mac-intel $(DIST)/sunday-lights-windows.exe

$(DIST)/sunday-lights-mac-apple-silicon: FORCE
	GOOS=darwin GOARCH=arm64 $(BUILD) -o $@ $(CMD)

$(DIST)/sunday-lights-mac-intel: FORCE
	GOOS=darwin GOARCH=amd64 $(BUILD) -o $@ $(CMD)

$(DIST)/sunday-lights-windows.exe: FORCE
	GOOS=windows GOARCH=amd64 $(BUILD) -o $@ $(CMD)

FORCE:

clean:
	rm -rf $(DIST)
