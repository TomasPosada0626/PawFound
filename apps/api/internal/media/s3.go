package media

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// S3Store guarda las fotos en un almacenamiento compatible con S3. Pensado para Cloudflare R2
// (capa gratuita, sin costo por descarga), pero sirve con cualquier S3. Firma las peticiones
// con AWS Signature V4 usando solo la librería estándar: sin dependencias nuevas.
//
// Los hostings gratuitos borran el disco en cada reinicio; por eso, en producción, las fotos
// van aquí y no en LocalStore.
type S3Store struct {
	// Endpoint, por ejemplo https://<cuenta>.r2.cloudflarestorage.com
	Endpoint  string
	Bucket    string
	AccessKey string
	SecretKey string
	// Region es "auto" en R2.
	Region string
	Client *http.Client
	Now    func() time.Time
}

// R2 arma el S3Store de Cloudflare R2 a partir del id de la cuenta.
func R2(accountID, bucket, accessKey, secretKey string) S3Store {
	return S3Store{
		Endpoint: "https://" + accountID + ".r2.cloudflarestorage.com", Bucket: bucket, AccessKey: accessKey,
		SecretKey: secretKey, Region: "auto",
	}
}

const unsignedPayload = "UNSIGNED-PAYLOAD"

// Put sube el archivo (siempre JPEG re-codificado, ver Process).
func (s S3Store) Put(ctx context.Context, key string, data []byte) error {
	res, err := s.do(ctx, http.MethodPut, key, data)
	if err != nil {
		return err
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode >= 300 {
		return fmt.Errorf("almacenamiento respondió %d al subir", res.StatusCode)
	}
	return nil
}

// Open descarga el archivo para servirlo.
func (s S3Store) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	res, err := s.do(ctx, http.MethodGet, key, nil)
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= 300 {
		_ = res.Body.Close()
		return nil, fmt.Errorf("almacenamiento respondió %d al leer", res.StatusCode)
	}
	return res.Body, nil
}

// Remove borra el archivo (al eliminar una cuenta o una foto sin usar).
func (s S3Store) Remove(ctx context.Context, key string) error {
	res, err := s.do(ctx, http.MethodDelete, key, nil)
	if err != nil {
		return err
	}
	_ = res.Body.Close()
	if res.StatusCode >= 300 && res.StatusCode != http.StatusNotFound {
		return fmt.Errorf("almacenamiento respondió %d al borrar", res.StatusCode)
	}
	return nil
}

func (s S3Store) do(ctx context.Context, method, key string, body []byte) (*http.Response, error) {
	if _, err := (LocalStore{}).path(key); err != nil {
		return nil, err // mismas reglas de clave que el disco local: nada de rutas
	}
	endpoint, err := url.Parse(strings.TrimRight(s.Endpoint, "/"))
	if err != nil || endpoint.Host == "" {
		return nil, fmt.Errorf("endpoint de almacenamiento inválido")
	}
	path := "/" + s.Bucket + "/" + key
	req, err := http.NewRequestWithContext(ctx, method, endpoint.Scheme+"://"+endpoint.Host+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	payloadHash := unsignedPayload
	if method == http.MethodPut {
		sum := sha256.Sum256(body)
		payloadHash = hex.EncodeToString(sum[:])
		req.Header.Set("Content-Type", "image/jpeg")
	}
	s.sign(req, endpoint.Host, path, payloadHash)
	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	return client.Do(req)
}

// sign agrega la firma AWS Signature V4 (host, x-amz-content-sha256 y x-amz-date firmados).
func (s S3Store) sign(req *http.Request, host, path, payloadHash string) {
	now := time.Now
	if s.Now != nil {
		now = s.Now
	}
	t := now().UTC()
	amzDate := t.Format("20060102T150405Z")
	day := t.Format("20060102")
	region := s.Region
	if region == "" {
		region = "auto"
	}
	req.Header.Set("x-amz-content-sha256", payloadHash)
	req.Header.Set("x-amz-date", amzDate)
	signed := "host;x-amz-content-sha256;x-amz-date"
	canonical := strings.Join([]string{
		req.Method, path, "",
		"host:" + host, "x-amz-content-sha256:" + payloadHash, "x-amz-date:" + amzDate, "",
		signed, payloadHash,
	}, "\n")
	scope := day + "/" + region + "/s3/aws4_request"
	sum := sha256.Sum256([]byte(canonical))
	toSign := "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" + hex.EncodeToString(sum[:])
	key := hmacSHA256([]byte("AWS4"+s.SecretKey), day)
	key = hmacSHA256(key, region)
	key = hmacSHA256(key, "s3")
	key = hmacSHA256(key, "aws4_request")
	signature := hex.EncodeToString(hmacSHA256(key, toSign))
	req.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+s.AccessKey+"/"+scope+", SignedHeaders="+signed+", Signature="+signature)
}

func hmacSHA256(key []byte, data string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(data))
	return mac.Sum(nil)
}
