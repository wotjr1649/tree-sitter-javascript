package main

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"os"
)

// packInputs writes a stream of little-endian uint32 lengths followed by source bytes.
func packInputs(path, root string, patterns []string) error {
	inputs, err := loadSelectedInputs(root, patterns)
	if err != nil {
		return err
	}
	if len(inputs) == 0 {
		return errors.New("no benchmark inputs")
	}
	out, err := os.Create(path)
	if err != nil {
		return err
	}
	defer out.Close()
	manifest, err := os.Create(path + ".jsonl")
	if err != nil {
		return err
	}
	defer manifest.Close()
	w := bufio.NewWriter(out)
	enc := json.NewEncoder(manifest)
	for _, in := range inputs {
		source := []byte(in.Source)
		if uint64(len(source)) >= uint64(^uint32(0)) {
			return fmt.Errorf("%s: no room for a one-byte edit", in.ID)
		}
		if err := binary.Write(w, binary.LittleEndian, uint32(len(source))); err != nil {
			return err
		}
		if _, err := w.Write(source); err != nil {
			return err
		}
		if err := enc.Encode(struct {
			ID     string `json:"id"`
			Bytes  int    `json:"bytes"`
			SHA256 string `json:"sha256"`
		}{in.ID, len(source), sum(source)}); err != nil {
			return err
		}
	}
	return w.Flush()
}
