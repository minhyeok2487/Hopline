package main

import (
	"bufio"
	"strings"
	"testing"
)

// Output of `claude remote-control` 2.1.310 as written to a pipe.
const rcSample = "\n·|· Connecting · Desktop\n\x1b[1A\x1b[J·✔︎· Connected · Desktop\n" +
	"    Capacity: 1/32 · New sessions will be created in the current directory\n" +
	"    \x1b]8;;https://claude.ai/code/session_019ijSzBpYhZu9wVXXnmEDCP?from=cli\x07Attached\x1b]8;;\x07\n\n" +
	"Continue coding in the Claude mobile app or https://claude.ai/code?environment=env_01KXEToAhNkXhjjhonaWT1oA\r\n" +
	"space to show QR code\n"

func TestRemoteControlLink(t *testing.T) {
	sc := bufio.NewScanner(strings.NewReader(rcSample))
	sc.Split(splitCRLF)
	var url string
	for sc.Scan() {
		line := ansiRe.ReplaceAllString(sc.Text(), "")
		if url == "" && rcURLRe.MatchString(line) {
			url = rcURLRe.FindString(line)
		}
	}
	if url != "https://claude.ai/code?environment=env_01KXEToAhNkXhjjhonaWT1oA" {
		t.Fatalf("url = %q", url)
	}
}
