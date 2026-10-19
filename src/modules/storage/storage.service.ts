import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** URL signées de courte durée (§14.1). */
export const SIGNED_URL_TTL_S = 15 * 60;

/**
 * Stockage objet compatible S3 (MinIO en développement, §11.1). Compartiment privé :
 * aucun fichier n'est public, tout passe par des URL signées.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('S3_BUCKET');
    this.s3 = new S3Client({
      endpoint: config.get<string>('S3_ENDPOINT') || undefined,
      region: config.getOrThrow<string>('S3_REGION'),
      forcePathStyle: config.get<boolean>('S3_FORCE_PATH_STYLE'),
      credentials: {
        accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY'),
        secretAccessKey: config.getOrThrow<string>('S3_SECRET_KEY'),
      },
    });
  }

  /** Crée le compartiment en développement s'il n'existe pas (MinIO). */
  async onModuleInit() {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Compartiment ${this.bucket} créé`);
      } catch (err) {
        this.logger.warn(`Stockage indisponible (${this.bucket}) : ${String(err)}`);
      }
    }
  }

  async put(key: string, body: Buffer | string, contentType: string) {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
    return key;
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async delete(key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** URL de téléchargement signée, valable 15 minutes par défaut. */
  signedUrl(key: string, opts: { ttlSeconds?: number; downloadName?: string } = {}) {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(opts.downloadName && {
          ResponseContentDisposition: `attachment; filename="${opts.downloadName.replace(/"/g, '')}"`,
        }),
      }),
      { expiresIn: opts.ttlSeconds ?? SIGNED_URL_TTL_S },
    );
  }
}
