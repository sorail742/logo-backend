import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import type { Env } from '../../config/env';

// Stockage des fichiers produits (§11.1, §14.1) : compartiment privé, fichiers servis par
// URL signée de courte durée. En développement, un dossier local remplace S3 ; l'API sert
// alors elle-même les URL signées (GET /files, StorageController).

/** Durée de validité par défaut d'une URL signée (§14.1 : 15 min). */
export const DEFAULT_URL_TTL_S = 15 * 60;

export interface SignedUrlOptions {
  /** Durée de validité en secondes. */
  expiresIn?: number;
  /** Nom proposé au téléchargement. */
  fileName?: string;
  /** Affichage dans le navigateur (PDF, images) plutôt que téléchargement. */
  inline?: boolean;
}

/** Paramètres d'une URL signée locale (`GET /files?key=…&exp=…&name=…&d=…&sig=…`). */
export interface SignedFileQuery {
  key?: string;
  exp?: string;
  name?: string;
  d?: string;
  sig?: string;
}

export interface ResolvedFile {
  /** Clé relative au dossier de stockage (`root`), servie sans pouvoir en sortir. */
  key: string;
  root: string;
  fileName: string;
  contentType: string;
  inline: boolean;
}

const KEY_PATTERN = /^[\w.@-]+(\/[\w.@-]+)*$/;

/** Clé de stockage sûre : segments alphanumériques, jamais « .. ». */
export function isSafeKey(key: string) {
  return KEY_PATTERN.test(key) && !key.split('/').some((segment) => /^\.+$/.test(segment));
}

const CONTENT_TYPES: Record<string, string> = {
  '.zip': 'application/zip',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export function contentTypeOf(key: string) {
  return CONTENT_TYPES[extname(key).toLowerCase()] ?? 'application/octet-stream';
}

/** En-tête Content-Disposition avec un nom de fichier UTF-8 (RFC 6266). */
export function contentDisposition(fileName: string, inline = false) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

@Injectable()
export class StorageService {
  private readonly driver: Env['STORAGE_DRIVER'];
  private readonly root: string;
  private readonly bucket: string;
  private readonly s3: S3Client | null;
  private readonly filesUrl: string;
  private readonly urlKey: Buffer;

  constructor(config: ConfigService<Env, true>) {
    this.driver = config.get('STORAGE_DRIVER', { infer: true });
    this.root = resolve(config.get('STORAGE_DIR', { infer: true }));
    this.bucket = config.get('S3_BUCKET', { infer: true });
    this.filesUrl = `${config.get('API_URL', { infer: true }).replace(/\/$/, '')}/api/v1/files`;
    // Clé dédiée aux URL signées, dérivée du secret des liens d'action.
    this.urlKey = createHmac('sha256', config.get('JWT_ACTION_SECRET', { infer: true }))
      .update('storage-signed-url')
      .digest();
    this.s3 =
      this.driver === 's3'
        ? new S3Client({
            endpoint: config.get('S3_ENDPOINT', { infer: true }),
            region: config.get('S3_REGION', { infer: true }),
            forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
            credentials: {
              accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }) ?? '',
              secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }) ?? '',
            },
          })
        : null;
  }

  async put(key: string, body: Buffer, contentType = contentTypeOf(key)) {
    if (this.s3) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: checkKey(key),
          Body: body,
          ContentType: contentType,
        }),
      );
      return;
    }
    const path = this.localPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async get(key: string): Promise<Buffer> {
    if (this.s3) {
      const object = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: checkKey(key) }),
      );
      return Buffer.from(await object.Body!.transformToByteArray());
    }
    return readFile(this.localPath(key));
  }

  /** Suppression idempotente : un fichier déjà absent n'est pas une erreur. */
  async delete(key: string) {
    if (this.s3) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: checkKey(key) }));
      return;
    }
    await rm(this.localPath(key), { force: true });
  }

  /** URL de téléchargement signée, valable `expiresIn` secondes. */
  async signedUrl(key: string, options: SignedUrlOptions = {}): Promise<string> {
    const expiresIn = options.expiresIn ?? DEFAULT_URL_TTL_S;
    const fileName = options.fileName ?? key.split('/').pop()!;
    if (this.s3) {
      return getSignedUrl(
        this.s3,
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: checkKey(key),
          ResponseContentDisposition: contentDisposition(fileName, options.inline),
        }),
        { expiresIn },
      );
    }
    const exp = String(Math.floor(Date.now() / 1000) + expiresIn);
    const d = options.inline ? 'inline' : 'attachment';
    const query = new URLSearchParams({ key: checkKey(key), exp, name: fileName, d });
    query.set('sig', this.sign(key, exp, fileName, d));
    return `${this.filesUrl}?${query.toString()}`;
  }

  /** Vérifie une URL signée locale : chemin du fichier, ou null si elle est invalide ou expirée. */
  resolveSigned(query: SignedFileQuery): ResolvedFile | null {
    const { key, exp, name, d, sig } = query;
    if (this.s3 || !key || !exp || !name || !sig || (d !== 'inline' && d !== 'attachment'))
      return null;
    if (!isSafeKey(key) || !/^\d{1,12}$/.test(exp)) return null;
    if (Number(exp) * 1000 < Date.now()) return null;
    const expected = Buffer.from(this.sign(key, exp, name, d), 'base64url');
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    return {
      key: checkKey(key),
      root: this.root,
      fileName: name,
      contentType: contentTypeOf(key),
      inline: d === 'inline',
    };
  }

  private sign(key: string, exp: string, name: string, disposition: string) {
    return createHmac('sha256', this.urlKey)
      .update([key, exp, name, disposition].join('\n'))
      .digest('base64url');
  }

  /** Chemin local d'une clé, sans sortie possible du dossier de stockage. */
  private localPath(key: string) {
    const path = resolve(this.root, checkKey(key));
    if (!path.startsWith(this.root + sep)) throw new Error(`Clé de stockage invalide : ${key}`);
    return path;
  }
}

function checkKey(key: string) {
  if (!isSafeKey(key)) throw new Error(`Clé de stockage invalide : ${key}`);
  return key;
}
