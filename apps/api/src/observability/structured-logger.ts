import { ConsoleLogger, type LoggerService } from '@nestjs/common';

/**
 * Cloud-friendly logger. Emits single-line JSON when LOG_FORMAT=json (or in
 * production), otherwise falls back to Nest's readable console output for local
 * dev. NEVER pass secrets/tokens into log messages — this formats only, it does
 * not scrub message contents.
 */
export class StructuredLogger extends ConsoleLogger implements LoggerService {
  private readonly json: boolean;
  private readonly base: Record<string, unknown>;

  constructor(opts: { format: 'pretty' | 'json'; env: string; version: string }) {
    super();
    this.json = opts.format === 'json';
    this.base = { env: opts.env, service: 'bmpl-api', version: opts.version };
  }

  private emit(level: string, message: unknown, context?: string) {
    if (!this.json) {
      // Delegate to Nest's pretty console for local dev.
      return;
    }
    process.stdout.write(
      JSON.stringify({
        level,
        time: new Date().toISOString(),
        context,
        msg: typeof message === 'string' ? message : message,
        ...this.base,
      }) + '\n',
    );
  }

  override log(message: unknown, context?: string) {
    this.json ? this.emit('info', message, context) : super.log(message as string, context as string);
  }
  override error(message: unknown, stack?: string, context?: string) {
    this.json ? this.emit('error', message, context) : super.error(message as string, stack, context);
  }
  override warn(message: unknown, context?: string) {
    this.json ? this.emit('warn', message, context) : super.warn(message as string, context as string);
  }
  override debug(message: unknown, context?: string) {
    this.json ? this.emit('debug', message, context) : super.debug?.(message as string, context as string);
  }
  override verbose(message: unknown, context?: string) {
    this.json
      ? this.emit('verbose', message, context)
      : super.verbose?.(message as string, context as string);
  }
}
