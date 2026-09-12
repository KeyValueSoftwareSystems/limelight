import express from 'express';

/**
 * Starts the HTTP transport layer.
 *
 * This is a thin adapter: it parses the HTTP request body into
 * `{ score, keys, format }`, hands it to the handler, and sends
 * back whatever the handler returns.  Adding a WebSocket or gRPC
 * transport means writing another adapter that calls the same handler.
 *
 * @param {object} opts
 * @param {object} opts.handler  Object with `async handle(req)`.
 * @param {string} opts.host
 * @param {number} opts.port
 * @returns {import('http').Server}
 */
export function startHttp({ handler, host, port }) {
  const app = express();

  app.use(express.json());

  app.post('/score', async (req, res) => {
    try {
      const result = await handler.handle(req.body);
      res.json(result);
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({
        error: err.code || 'INTERNAL_ERROR',
        message: err.message,
      });
    }
  });

  const server = app.listen(port, host, () => {
    console.log(`  score server on http://${host}:${port}`);
  });

  return server;
}
