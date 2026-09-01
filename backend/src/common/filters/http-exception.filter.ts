import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Filtre d'exception global. Ne fuit jamais la stack technique au client ;
 * journalise systématiquement les erreurs 5xx (logs techniques essentiels, Lot 0).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = isHttp ? exception.getResponse() : { message: 'Erreur interne du serveur' };

    const payload =
      typeof body === 'string'
        ? { statusCode: status, message: body }
        : { statusCode: status, ...(body as Record<string, unknown>) };

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} -> ${status} ${JSON.stringify(payload.message ?? '')}`);
    }

    response.status(status).json({ ...payload, path: request.url, timestamp: new Date().toISOString() });
  }
}
