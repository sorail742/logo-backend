import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

/** Toutes les erreurs au format application/problem+json (RFC 7807, §13.1). */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let detail = 'Erreur interne';
    let extra: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        detail = body;
      } else {
        const { message, error: _error, statusCode: _sc, ...rest } = body as Record<string, unknown>;
        if (Array.isArray(message)) {
          detail = 'Données invalides';
          extra.errors = message;
        } else {
          detail = typeof message === 'string' ? message : exception.message;
        }
        extra = { ...extra, ...rest };
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        detail = 'Cette ressource existe déjà';
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        detail = 'Ressource introuvable';
      }
    }

    if (status >= 500) this.logger.error(exception);

    res
      .status(status)
      .type('application/problem+json')
      .json({
        type: 'about:blank',
        title: HttpStatus[status] ?? 'Error',
        status,
        detail,
        instance: req.originalUrl,
        ...extra,
      });
  }
}
