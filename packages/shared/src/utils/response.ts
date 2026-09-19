import { IApiResponse } from '../interfaces';

export function ok<T>(data: T, message?: string): IApiResponse<T> {
  return { success: true, data, message };
}

export function fail(error: string, message?: string): IApiResponse<never> {
  return { success: false, error, message };
}

export function created<T>(data: T): IApiResponse<T> {
  return { success: true, data, message: 'Created successfully' };
}
