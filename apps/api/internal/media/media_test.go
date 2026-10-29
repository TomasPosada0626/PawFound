package media

import (
	"bytes"
	"context"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"testing"
)

func testImage(w, h int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x * 255 / w), G: uint8(y * 255 / h), B: 90, A: 255})
		}
	}
	return img
}

func encodeJPEG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// withExif inserta un bloque APP1 con GPS falso y la orientación pedida justo después de SOI.
func withExif(jpg []byte, orientation uint16, order binary.ByteOrder) []byte {
	tiff := new(bytes.Buffer)
	if order == binary.LittleEndian {
		tiff.WriteString("II")
	} else {
		tiff.WriteString("MM")
	}
	_ = binary.Write(tiff, order, uint16(42))
	_ = binary.Write(tiff, order, uint32(8))
	_ = binary.Write(tiff, order, uint16(2))
	// Etiqueta 0x8825 (GPS) y 0x0112 (orientación), tipo SHORT.
	for _, tag := range [][2]uint16{{0x8825, 7}, {0x0112, orientation}} {
		_ = binary.Write(tiff, order, tag[0])
		_ = binary.Write(tiff, order, uint16(3))
		_ = binary.Write(tiff, order, uint32(1))
		_ = binary.Write(tiff, order, tag[1])
		_ = binary.Write(tiff, order, uint16(0))
	}
	payload := append([]byte("Exif\x00\x00"), tiff.Bytes()...)
	seg := []byte{0xFF, 0xE1, 0, 0}
	binary.BigEndian.PutUint16(seg[2:], uint16(len(payload)+2))
	out := append([]byte{}, jpg[:2]...)
	out = append(out, seg...)
	out = append(out, payload...)
	return append(out, jpg[2:]...)
}

func TestProcessStripsMetadataAndRotates(t *testing.T) {
	raw := withExif(encodeJPEG(t, testImage(200, 100)), 6, binary.BigEndian)
	if !bytes.Contains(raw, []byte("Exif")) {
		t.Fatal("el fixture debe traer EXIF")
	}
	out, err := Process(raw)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(out.Data, []byte("Exif")) {
		t.Fatal("el resultado conserva EXIF")
	}
	// Orientación 6 = girar 90° a la derecha: 200×100 → 100×200.
	if out.Width != 100 || out.Height != 200 {
		t.Fatalf("dimensiones = %dx%d", out.Width, out.Height)
	}
	little := withExif(encodeJPEG(t, testImage(200, 100)), 3, binary.LittleEndian)
	if got := jpegOrientation(little); got != 3 {
		t.Fatalf("orientación little-endian = %d", got)
	}
}

func TestProcessResizesAndAcceptsPNG(t *testing.T) {
	var buf bytes.Buffer
	_ = png.Encode(&buf, testImage(3200, 800))
	out, err := Process(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if out.Width != MaxSide || out.Height != 400 {
		t.Fatalf("dimensiones = %dx%d", out.Width, out.Height)
	}
	if _, err := jpeg.Decode(bytes.NewReader(out.Data)); err != nil {
		t.Fatal("la salida debe ser JPEG")
	}
	tall := fit(testImage(100, 3200), MaxSide).Bounds()
	if tall.Dx() != 50 || tall.Dy() != MaxSide {
		t.Fatalf("vertical = %v", tall)
	}
}

func TestProcessRejectsBadInput(t *testing.T) {
	for name, raw := range map[string][]byte{
		"texto":       []byte("<script>alert(1)</script>"),
		"muy pequeña": encodeJPEG(t, testImage(20, 20)),
		"truncada":    encodeJPEG(t, testImage(200, 200))[:300],
	} {
		if _, err := Process(raw); err != ErrNotImage {
			t.Errorf("%s: err = %v", name, err)
		}
	}
}

func TestAllOrientations(t *testing.T) {
	src := testImage(4, 2)
	for o := 1; o <= 8; o++ {
		b := applyOrientation(src, o).Bounds()
		wantW, wantH := 4, 2
		if o >= 5 {
			wantW, wantH = 2, 4
		}
		if b.Dx() != wantW || b.Dy() != wantH {
			t.Errorf("orientación %d: %v", o, b)
		}
	}
	if applyOrientation(src, 9) != src {
		t.Error("orientación inválida debe ignorarse")
	}
	for _, raw := range [][]byte{nil, {0xFF, 0xD8}, {0xFF, 0xD8, 0xFF, 0xDA, 0, 2}, {0x89, 0x50}} {
		if jpegOrientation(raw) != 1 {
			t.Errorf("jpegOrientation(%v) != 1", raw)
		}
	}
	for _, tiff := range [][]byte{nil, []byte("XX\x00\x2a\x00\x00\x00\x08"), []byte("MM\x00\x2a\x00\x00\x00\xff")} {
		if exifOrientation(tiff) != 1 {
			t.Errorf("exifOrientation(%q) != 1", tiff)
		}
	}
}

func TestDHashFindsNearDuplicates(t *testing.T) {
	a := testImage(400, 300)
	reencoded, _ := jpeg.Decode(bytes.NewReader(encodeJPEG(t, a)))
	if d := HashDistance(DHash(a), DHash(reencoded)); d > NearDuplicate {
		t.Fatalf("la misma foto re-comprimida quedó a %d bits", d)
	}
	other := image.NewRGBA(image.Rect(0, 0, 400, 300))
	for y := 0; y < 300; y++ {
		for x := 0; x < 400; x++ {
			other.Set(x, y, color.RGBA{R: uint8((x * y) % 256), G: uint8(255 - x%256), B: uint8(y % 256), A: 255})
		}
	}
	if d := HashDistance(DHash(a), DHash(other)); d <= NearDuplicate {
		t.Fatalf("fotos distintas a solo %d bits", d)
	}
}

func TestLocalStore(t *testing.T) {
	s := LocalStore{Dir: t.TempDir()}
	ctx := context.Background()
	if err := s.Put(ctx, "med_1.jpg", []byte("x")); err != nil {
		t.Fatal(err)
	}
	f, err := s.Open(ctx, "med_1.jpg")
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(f)
	_ = f.Close()
	if string(got) != "x" {
		t.Fatal("contenido")
	}
	for _, bad := range []string{"", "../etc/passwd", "a/b", `a\b`, "c:x"} {
		if err := s.Put(ctx, bad, nil); err != ErrBadKey {
			t.Errorf("Put(%q) = %v", bad, err)
		}
		if _, err := s.Open(ctx, bad); err != ErrBadKey {
			t.Errorf("Open(%q) = %v", bad, err)
		}
	}
}
