package main

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

// protect/unprotect wrap Windows DPAPI: stored passwords can only be decrypted
// by the same Windows user on the same machine.

func protect(data []byte) ([]byte, error) {
	return dpapi(data, true)
}

func unprotect(data []byte) ([]byte, error) {
	return dpapi(data, false)
}

func dpapi(data []byte, encrypt bool) ([]byte, error) {
	if len(data) == 0 {
		return nil, nil
	}
	in := windows.DataBlob{Size: uint32(len(data)), Data: &data[0]}
	var out windows.DataBlob
	var err error
	if encrypt {
		err = windows.CryptProtectData(&in, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out)
	} else {
		err = windows.CryptUnprotectData(&in, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out)
	}
	if err != nil {
		return nil, err
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	res := make([]byte, out.Size)
	copy(res, unsafe.Slice(out.Data, out.Size))
	return res, nil
}
