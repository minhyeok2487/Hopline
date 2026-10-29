package main

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
)

func TestAssetPattern(t *testing.T) {
	for name, want := range map[string]string{
		"Hopline.zip": "zip", "Hopline.exe": "exe", "Hopline-0.9.1.zip": "zip", "Hopline-0.9.1.exe": "exe",
		"Hopline-0.9.1.zip.sha256": "", "Other.zip": "",
	} {
		m := assetRe.FindStringSubmatch(name)
		got := ""
		if m != nil {
			got = m[2]
		}
		if got != want {
			t.Errorf("%s: got %q, want %q", name, got, want)
		}
	}
}

func TestUnzipExe(t *testing.T) {
	path := filepath.Join(t.TempDir(), "update.tmp")
	f, _ := os.Create(path)
	zw := zip.NewWriter(f)
	w, _ := zw.Create("README.txt")
	_, _ = w.Write([]byte("readme"))
	w, _ = zw.Create("Hopline.exe")
	_, _ = w.Write([]byte("MZ new build"))
	_ = zw.Close()
	_ = f.Close()

	if err := unzipExe(path); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(path); string(b) != "MZ new build" {
		t.Fatalf("got %q", b)
	}

	empty := filepath.Join(t.TempDir(), "empty.tmp")
	f, _ = os.Create(empty)
	_ = zip.NewWriter(f).Close()
	_ = f.Close()
	if err := unzipExe(empty); err == nil {
		t.Fatal("expected an error for a zip without an exe")
	}
}
