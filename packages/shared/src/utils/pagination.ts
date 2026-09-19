import { IPaginated } from '../interfaces';

export interface PaginationParams {
  page?:  number;
  limit?: number;
}

export function normalizePagination(params: PaginationParams): {
  page:   number;
  limit:  number;
  skip:   number;
  take:   number;
} {
  const page  = Math.max(1, params.page  ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

export function paginate<T>(
  data:  T[],
  total: number,
  page:  number,
  limit: number,
): IPaginated<T> {
  return {
    data,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  };
}
