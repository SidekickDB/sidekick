# Self Hosting InstantDB

Documentation for self hosting is available at [www.instantdb.com/docs/self-hosting](https://instantdb.com/docs/self-hosting)

See [UPGRADE_DB.md](UPGRADE_DB.md) for instructions on upgrading existing backends from postgres 16 to 17.

## Object storage

The compose files run [RustFS](https://rustfs.com), an S3-compatible object
store, as the `storage` service (image `rustfs/rustfs:1.0.6`). The
`createbuckets` service creates `S3_BUCKET` and `S3_APP_BACKUPS_BUCKET` with the
RustFS client (`rustfs/rc:v0.1.38`). Both images can be changed with
`STORAGE_IMAGE` and `STORAGE_CLIENT_IMAGE`; see `.env.example`. The RustFS
console listens on port 9001.

Two settings exist only because of RustFS 1.0.6 behaviour:

- The server runs with `AWS_REQUEST_CHECKSUM_CALCULATION=when_required`.
  Backups upload with `Content-Encoding: zstd`; with the AWS SDK's default
  checksum mode the request carries a second Content-Encoding (`aws-chunked`)
  and RustFS rejects it with `duplicate header: content-encoding`.
- `createbuckets` sets CORS rules (GET and HEAD from any origin) on both
  buckets. MinIO allowed every origin by default; RustFS sends no CORS headers
  without bucket rules, which blocks browser `fetch()` of file URLs.

Upgrading from the MinIO-based compose files: MinIO ran as the `minio` service
with its data in the `minio_data` volume. The `storage` service starts with an
empty `storage_data` volume, so existing files are not carried over. Copy the
buckets to the new store with an S3 client before switching, and change
`S3_ENDPOINT` in `.env` from `http://minio:9000` to `http://storage:9000`.
The upstream `minio/minio` and `minio/mc` images are no longer on Docker Hub.
`swarm.yml` cannot fall back to the old names, so it requires
`STORAGE_SECRET_KEY` (formerly `MINIO_ROOT_PASSWORD`) and refuses to deploy
without it; set `STORAGE_ACCESS_KEY` too if you had set `MINIO_ROOT_USER`.
