import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface RequestWithId extends Request {
  id?: string;
}

/**
 * Assigns a correlation id to every request (honoring an inbound
 * `x-request-id` from a trusted proxy) and echoes it on the response, so logs
 * and client errors can be tied together.
 */
export function requestIdMiddleware(req: RequestWithId, res: Response, next: NextFunction): void {
  const inbound = req.headers['x-request-id'];
  const id = (typeof inbound === 'string' && inbound.slice(0, 64)) || randomUUID();
  req.id = id;
  res.setHeader('x-request-id', id);
  next();
}
