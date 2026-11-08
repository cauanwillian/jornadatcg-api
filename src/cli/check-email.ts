import 'dotenv/config';
import { runEmailCheck } from './email-check.js';

process.exitCode = await runEmailCheck(process.argv.slice(2));
