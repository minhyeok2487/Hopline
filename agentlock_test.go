package main

import (
	"testing"
	"time"
)

func TestClaimOneCommandAtATime(t *testing.T) {
	a := &App{}
	lc := &liveConn{id: "t1", name: "sw1"}

	rel, err := a.claim(lc, "A")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.claim(lc, "B"); err == nil {
		t.Fatal("B claimed a tab A is running a command on")
	}
	if _, err := a.claim(lc, "A"); err == nil {
		t.Fatal("A ran two commands on one tab at once")
	}
	rel()

	// A still owns the tab for the lease, so B is kept out but A can go on.
	if _, err := a.claim(lc, "B"); err == nil {
		t.Fatal("B took A's tab inside the lease")
	}
	rel, err = a.claim(lc, "A")
	if err != nil {
		t.Fatal(err)
	}
	rel()

	// After the lease the tab is free again.
	lc.lock.seen = time.Now().Add(-agentLease - time.Second)
	if rel, err = a.claim(lc, "B"); err != nil {
		t.Fatal(err)
	}
	rel()
}

func TestTryOwnAndState(t *testing.T) {
	lc := &liveConn{}
	if st := lc.lock.state("A"); st != "" {
		t.Fatalf("free tab state = %q", st)
	}
	if !lc.lock.tryOwn("A") {
		t.Fatal("A could not take a free tab")
	}
	if lc.lock.tryOwn("B") {
		t.Fatal("B took A's tab")
	}
	if st := lc.lock.state("A"); st != "yours" {
		t.Fatalf("owner sees %q", st)
	}
	if st := lc.lock.state("B"); st != "in use by another AI session" {
		t.Fatalf("other sees %q", st)
	}
}
