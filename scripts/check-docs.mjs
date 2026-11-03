// Repository-only documentation check. Never installed in consuming projects.
import { parseDocsCliArgs, runDocs } from './lib/docs.mjs';
try {
  const options = parseDocsCliArgs(['check', ...process.argv.slice(2)]);
  process.exitCode = runDocs({ options });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
