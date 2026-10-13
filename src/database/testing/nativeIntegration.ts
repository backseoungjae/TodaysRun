import { openDatabase } from '../database';
import { executeIntegrationCase, integrationCases } from './integrationScenarios';

// Metro가 제외하는 __tests__ 밖에 두고 테스트 전용 entry에서만 실행한다.
export async function runNativeIntegration(): Promise<void> {
  const prefix = `todaysrun-sqlite-test-${Date.now()}`;
  for (const [index, testCase] of integrationCases.entries()) {
    await executeIntegrationCase(testCase, openDatabase, `${prefix}-${index}.db`);
    console.log(`SQLITE_TEST_PASS ${testCase.name}`);
  }
  console.log(`SQLITE_TEST_COMPLETE ${integrationCases.length}`);
}
