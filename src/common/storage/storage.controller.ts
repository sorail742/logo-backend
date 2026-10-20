import { Controller, Get, NotFoundException, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { stat } from 'node:fs/promises';
import { Public } from '../decorators';
import { contentDisposition, StorageService, type SignedFileQuery } from './storage.service';

/**
 * Téléchargement par URL signée quand les fichiers sont sur disque (STORAGE_DRIVER=local).
 * Avec S3, les URL signées pointent directement sur le compartiment.
 */
@ApiExcludeController()
@Public()
@Controller('files')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Get()
  async download(@Query() query: SignedFileQuery, @Res() res: Response) {
    const file = this.storage.resolveSigned(query);
    // Lien invalide, falsifié ou expiré : même réponse qu'un fichier absent.
    if (!file || !(await stat(file.path).catch(() => null))?.isFile())
      throw new NotFoundException();
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', contentDisposition(file.fileName, file.inline));
    res.setHeader('Cache-Control', 'private, no-store');
    // Le front (autre origine) peut afficher un cachet ou une charte servis par ce lien.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.sendFile(file.path);
  }
}
