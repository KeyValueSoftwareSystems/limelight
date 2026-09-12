import { createFileStore } from './store/file.js';
import { createHandler }   from './handler.js';
import { startHttp }       from './transport/http.js';

const PORT      = parseInt(process.env.PORT      || '8780', 10);
const HOST      = process.env.HOST               || '127.0.0.1';
const SCORE_DIR = process.env.SCORE_DIR          || new URL('../protocol', import.meta.url).pathname;

const store   = createFileStore(SCORE_DIR);
const handler = createHandler({ store });

startHttp({ handler, host: HOST, port: PORT });
