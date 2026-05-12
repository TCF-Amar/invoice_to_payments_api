// ─── API Error ────────────────────────────────────────
export class ApiError extends Error {
  statusCode: number;
  errors: any[];

  constructor(statusCode: number, message: string, errors: any[] = []) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    this.name = 'ApiError';
    Error.captureStackTrace(this, this.constructor);
  }
}

// ─── BigInt & Decimal Serializer ──────────────────────
export const serializeBigInt = (obj: any): any => {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'bigint') {
    return obj.toString();
  }

  // Handle Date objects
  if (obj instanceof Date) {
    return obj.toISOString();
  }

  // Handle Prisma Decimal type
  // Robust check: constructor name OR characteristic s, e, d properties
  if (
    obj && typeof obj === 'object' &&
    ((obj.constructor && obj.constructor.name === 'Decimal') ||
      (obj.s !== undefined && obj.e !== undefined && obj.d !== undefined)) &&
    typeof obj.toString === 'function'
  ) {
    return parseFloat(obj.toString());
  }

  if (Array.isArray(obj)) {
    return obj.map(serializeBigInt);
  }

  if (typeof obj === 'object') {
    const serialized: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        serialized[key] = serializeBigInt(obj[key]);
      }
    }
    return serialized;
  }

  return obj;
};

// ─── API Response ─────────────────────────────────────
export class ApiResponse<T> {
  success: boolean;
  statusCode: number;
  message: string;
  data: T;

  constructor(statusCode: number, message: string, data: T) {
    this.success = statusCode < 400;
    this.statusCode = statusCode;
    this.message = message;
    // Don't serialize here - let middleware handle it
    this.data = data;
  }
}

// ─── Async Handler ────────────────────────────────────
import { Request, Response, NextFunction } from 'express';

export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
