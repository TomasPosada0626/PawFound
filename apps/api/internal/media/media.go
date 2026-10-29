// Package media procesa las fotos que suben las personas (issue #38).
//
// Toda imagen se decodifica y se vuelve a codificar como JPEG: el codificador de Go no
// escribe metadatos, así que el archivo guardado no conserva EXIF, GPS ni el modelo del
// celular, venga como venga. Antes de descartar el EXIF se aplica su orientación (si no, las
// fotos de celular quedarían de lado). Se rechazan archivos que no son imágenes reales y
// dimensiones absurdas (bombas de descompresión), y se calcula un hash perceptual para
// detectar la misma foto usada en publicaciones de cuentas distintas (fraude).
package media

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	_ "image/png" // registra el decodificador PNG
	"io"
	"math/bits"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp" // registra el decodificador WebP
)

// Límites de subida.
const (
	MaxUploadBytes = 8 << 20
	MaxSide        = 1600
	maxInputSide   = 12_000
	maxInputPixels = 50_000_000
	minSide        = 64
	jpegQuality    = 82
)

// ErrNotImage: el archivo no es JPEG, PNG ni WebP válido, o sus dimensiones no se aceptan.
var ErrNotImage = errors.New("el archivo no es una imagen válida")

// Processed es la imagen lista para guardar.
type Processed struct {
	Data   []byte
	Width  int
	Height int
	PHash  int64
}

// Process valida, orienta, redimensiona y re-codifica la imagen.
func Process(raw []byte) (Processed, error) {
	cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return Processed{}, ErrNotImage
	}
	if cfg.Width < minSide || cfg.Height < minSide || cfg.Width > maxInputSide || cfg.Height > maxInputSide ||
		cfg.Width*cfg.Height > maxInputPixels {
		return Processed{}, ErrNotImage
	}
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return Processed{}, ErrNotImage
	}
	if format == "jpeg" {
		img = applyOrientation(img, jpegOrientation(raw))
	}
	img = fit(img, MaxSide)
	var out bytes.Buffer
	if err := jpeg.Encode(&out, img, &jpeg.Options{Quality: jpegQuality}); err != nil {
		return Processed{}, err
	}
	b := img.Bounds()
	return Processed{Data: out.Bytes(), Width: b.Dx(), Height: b.Dy(), PHash: DHash(img)}, nil
}

func fit(img image.Image, maxSide int) image.Image {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= maxSide && h <= maxSide {
		return toRGBA(img)
	}
	if w >= h {
		h = max(1, h*maxSide/w)
		w = maxSide
	} else {
		w = max(1, w*maxSide/h)
		h = maxSide
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.BiLinear.Scale(dst, dst.Bounds(), img, b, draw.Over, nil)
	return dst
}

func toRGBA(img image.Image) *image.RGBA {
	b := img.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(dst, dst.Bounds(), img, b.Min, draw.Src)
	return dst
}

// DHash es un hash perceptual de 64 bits (diferencia de gradientes en 9×8 grises). Dos fotos
// casi iguales (recortadas, re-comprimidas) quedan a pocos bits de distancia.
func DHash(img image.Image) int64 {
	small := image.NewGray(image.Rect(0, 0, 9, 8))
	draw.BiLinear.Scale(small, small.Bounds(), img, img.Bounds(), draw.Src, nil)
	var hash uint64
	for y := 0; y < 8; y++ {
		for x := 0; x < 8; x++ {
			hash <<= 1
			if small.GrayAt(x, y).Y > small.GrayAt(x+1, y).Y {
				hash |= 1
			}
		}
	}
	return int64(hash) //nolint:gosec // se guarda el patrón de bits tal cual en un bigint
}

// HashDistance cuenta los bits distintos entre dos hashes.
func HashDistance(a, b int64) int {
	return bits.OnesCount64(uint64(a ^ b)) //nolint:gosec // comparación de patrones de bits
}

// NearDuplicate es el umbral a partir del cual dos fotos se consideran la misma.
const NearDuplicate = 6

// jpegOrientation lee la etiqueta de orientación (0x0112) del bloque EXIF; 1 si no hay.
func jpegOrientation(raw []byte) int {
	r := bytes.NewReader(raw)
	var marker [2]byte
	if _, err := io.ReadFull(r, marker[:]); err != nil || marker != [2]byte{0xFF, 0xD8} {
		return 1
	}
	for {
		if _, err := io.ReadFull(r, marker[:]); err != nil || marker[0] != 0xFF {
			return 1
		}
		var size uint16
		if err := binary.Read(r, binary.BigEndian, &size); err != nil || size < 2 {
			return 1
		}
		segment := make([]byte, size-2)
		if _, err := io.ReadFull(r, segment); err != nil {
			return 1
		}
		if marker[1] == 0xE1 && bytes.HasPrefix(segment, []byte("Exif\x00\x00")) {
			return exifOrientation(segment[6:])
		}
		if marker[1] == 0xDA { // inicio de los datos de imagen: ya no hay más metadatos
			return 1
		}
	}
}

func exifOrientation(tiff []byte) int {
	if len(tiff) < 8 {
		return 1
	}
	var order binary.ByteOrder
	switch string(tiff[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 1
	}
	offset := int(order.Uint32(tiff[4:8]))
	if offset+2 > len(tiff) {
		return 1
	}
	count := int(order.Uint16(tiff[offset:]))
	for i := 0; i < count; i++ {
		entry := offset + 2 + i*12
		if entry+12 > len(tiff) {
			return 1
		}
		if order.Uint16(tiff[entry:]) == 0x0112 {
			v := int(order.Uint16(tiff[entry+8:]))
			if v >= 1 && v <= 8 {
				return v
			}
			return 1
		}
	}
	return 1
}

// applyOrientation transforma la imagen según la orientación EXIF (1–8).
func applyOrientation(img image.Image, orientation int) image.Image {
	if orientation <= 1 || orientation > 8 {
		return img
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	transposed := orientation >= 5
	dw, dh := w, h
	if transposed {
		dw, dh = h, w
	}
	dst := image.NewRGBA(image.Rect(0, 0, dw, dh))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			var dx, dy int
			switch orientation {
			case 2:
				dx, dy = w-1-x, y
			case 3:
				dx, dy = w-1-x, h-1-y
			case 4:
				dx, dy = x, h-1-y
			case 5:
				dx, dy = y, x
			case 6:
				dx, dy = h-1-y, x
			case 7:
				dx, dy = h-1-y, w-1-x
			case 8:
				dx, dy = y, w-1-x
			}
			dst.Set(dx, dy, color.RGBAModel.Convert(img.At(b.Min.X+x, b.Min.Y+y)))
		}
	}
	return dst
}

// Store guarda los archivos procesados. En desarrollo, disco local; en producción, Cloudflare
// R2 cuando se complete su evaluación (issue #38).
type Store interface {
	Put(ctx context.Context, key string, data []byte) error
	Open(ctx context.Context, key string) (io.ReadCloser, error)
}

// LocalStore guarda en un directorio del servidor.
type LocalStore struct{ Dir string }

// ErrBadKey protege contra rutas que intenten salir del directorio.
var ErrBadKey = errors.New("clave de archivo inválida")

func (s LocalStore) path(key string) (string, error) {
	if key == "" || strings.ContainsAny(key, `/\:`) || strings.Contains(key, "..") {
		return "", ErrBadKey
	}
	return filepath.Join(s.Dir, key), nil
}

// Put escribe el archivo con permisos solo para el proceso.
func (s LocalStore) Put(_ context.Context, key string, data []byte) error {
	p, err := s.path(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(s.Dir, 0o750); err != nil {
		return fmt.Errorf("crear directorio de imágenes: %w", err)
	}
	return os.WriteFile(p, data, 0o600)
}

// Remove borra el archivo (al eliminar una cuenta).
func (s LocalStore) Remove(_ context.Context, key string) error {
	p, err := s.path(key)
	if err != nil {
		return err
	}
	return os.Remove(p)
}

// Open abre el archivo para servirlo.
func (s LocalStore) Open(_ context.Context, key string) (io.ReadCloser, error) {
	p, err := s.path(key)
	if err != nil {
		return nil, err
	}
	return os.Open(p) //nolint:gosec // la ruta se validó en path()
}
