import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeIntegrationCase, integrationCases } from '../testing/integrationScenarios';
import { openNodeDatabase } from './nodeSqlite';

describe('실제 SQLite 엔진 Repository 통합', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'todaysrun-sqlite-test-'));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  it.each(integrationCases)('$name', async (testCase) => {
    await executeIntegrationCase(
      testCase,
      (name) => openNodeDatabase(join(directory, name)),
      'integration.db',
    );
  });
});
