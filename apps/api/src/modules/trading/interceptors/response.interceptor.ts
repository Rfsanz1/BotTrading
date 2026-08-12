/**
 * Global Error and Response Interceptor
 * Standardizes all API responses and error handling
 */

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ValidationError } from 'class-validator';

interface ErrorResponse {
  success: false;
  statusCode: number;
  message: string;
  errors?: any[];
  timestamp: string;
  path: string;
}

interface SuccessResponse<T> {
  success: true;
  statusCode: number;
  data: T;
  message?: string;
  timestamp: string;
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ResponseInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.getRequest();
    const response = context.getResponse();
    const startTime = Date.now();

    return next.handle().pipe(
      map((data) => {
        const statusCode = response.statusCode || HttpStatus.OK;
        const result: SuccessResponse<any> = {
          success: true,
          statusCode,
          data: data?.data || data,
          message: data?.message,
          timestamp: new Date().toISOString(),
        };

        this.logger.log(
          `${request.method} ${request.path} - ${statusCode} (${Date.now() - startTime}ms)`,
        );

        return result;
      }),
      catchError((error) => {
        const statusCode =
          error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

        let message = error.message || 'Internal server error';
        let errors: any[] = [];

        // Handle class-validator validation errors
        if (Array.isArray(error.message)) {
          errors = this.formatValidationErrors(error.message as ValidationError[]);
          message = 'Validation failed';
        }

        // Handle HttpException with validation errors
        if (error instanceof BadRequestException) {
          const response = error.getResponse() as any;
          if (response.message && Array.isArray(response.message)) {
            errors = response.message;
            message = 'Validation failed';
          }
        }

        const errorResponse: ErrorResponse = {
          success: false,
          statusCode,
          message,
          ...(errors.length > 0 && { errors }),
          timestamp: new Date().toISOString(),
          path: request.path,
        };

        this.logger.error(
          `${request.method} ${request.path} - ${statusCode}: ${message} (${Date.now() - startTime}ms)`,
          error.stack,
        );

        response.status(statusCode);
        return throwError(() => errorResponse);
      }),
    );
  }

  private formatValidationErrors(errors: ValidationError[]): any[] {
    return errors.map((error) => ({
      field: error.property,
      messages: Object.values(error.constraints || {}),
    }));
  }
}

@Injectable()
export class ExceptionFilter {
  private readonly logger = new Logger(ExceptionFilter.name);

  catch(exception: any, host: any): any {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const errorResponse = {
      success: false,
      statusCode,
      message: exception.message || 'Internal server error',
      timestamp: new Date().toISOString(),
      path: request.path,
      ...(process.env.NODE_ENV === 'development' && { stack: exception.stack }),
    };

    this.logger.error(
      `${request.method} ${request.path} - ${statusCode}: ${exception.message}`,
      exception.stack,
    );

    response.status(statusCode).json(errorResponse);
  }
}
