import { Controller, Get, HttpStatus, NotFoundException, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
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
  download(@Query() query: SignedFileQuery, @Req() req: Request, @Res() res: Response) {
    const file = this.storage.resolveSigned(query);
    // Lien invalide, falsifié ou expiré : même réponse qu'un fichier absent.
    if (!file) throw new NotFoundException();
    // Fichier servi relativement au dossier de stockage : Express refuse toute sortie de `root`.
    res.sendFile(
      file.key,
      {
        root: file.root,
        dotfiles: 'deny',
        headers: {
          'Content-Type': file.contentType,
          'Content-Disposition': contentDisposition(file.fileName, file.inline),
          'Cache-Control': 'private, no-store',
          // Le front (autre origine) peut afficher un cachet ou une charte servis par ce lien.
          'Cross-Origin-Resource-Policy': 'cross-origin',
        },
      },
      (error) => {
        if (!error || res.headersSent) return;
        res.status(HttpStatus.NOT_FOUND).type('application/problem+json').json({
          type: 'about:blank',
          title: HttpStatus[HttpStatus.NOT_FOUND],
          status: HttpStatus.NOT_FOUND,
          detail: 'Fichier introuvable',
          instance: req.originalUrl,
        });
      },
    );
  }
}
