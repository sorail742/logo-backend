import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { omit } from '../utils/object.util';
import type { Request, Response } from 'express';

/** Toutes les erreurs au format application/problem+json (RFC 7807, §13.1). */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();

    const { status, detail, extra } = describe(exception);

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

interface ProblemParts {
  status: number;
  detail: string;
  extra: Record<string, unknown>;
}

/** Statut, message et champs complémentaires d'une exception. */
function describe(exception: unknown): ProblemParts {
  if (exception instanceof HttpException) return fromHttpException(exception);
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    if (exception.code === 'P2002') {
      return { status: HttpStatus.CONFLICT, detail: 'Cette ressource existe déjà', extra: {} };
    }
    if (exception.code === 'P2025') {
      return { status: HttpStatus.NOT_FOUND, detail: 'Ressource introuvable', extra: {} };
    }
  }
  return { status: HttpStatus.INTERNAL_SERVER_ERROR, detail: 'Erreur interne', extra: {} };
}

/** Exception HTTP de Nest : message, liste d'erreurs de validation, champs ajoutés. */
function fromHttpException(exception: HttpException): ProblemParts {
  const status = exception.getStatus();
  const body = exception.getResponse();
  if (typeof body === 'string') return { status, detail: body, extra: {} };
  const { message } = body as Record<string, unknown>;
  const rest = omit(body as Record<string, unknown>, ['message', 'error', 'statusCode']);
  if (Array.isArray(message))
    return { status, detail: 'Données invalides', extra: { errors: message, ...rest } };
  return { status, detail: typeof message === 'string' ? message : exception.message, extra: rest };
}
