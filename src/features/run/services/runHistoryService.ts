import { getDatabase } from '@/database/database';
import { createRunRepository } from '@/database/repositories/runRepository';
import { getRunService } from './runRuntime';

export const runHistoryService = {
  async list() {
    return createRunRepository(await getDatabase()).listCompleted();
  },
  async remove(id: string) {
    const service = await getRunService();
    await service.manageRecords(async () =>
      createRunRepository(await getDatabase()).deleteById(id, true),
    );
  },
  async deletionBlock(): Promise<string | null> {
    if ((await getRunService()).hasActiveRun()) return '러닝 중에는 전체 기록을 삭제할 수 없어요.';
    if ((await createRunRepository(await getDatabase()).findUnfinished()).length)
      return '미완료 기록을 복구한 후 전체 기록을 삭제해 주세요.';
    return null;
  },
  async removeAll() {
    const service = await getRunService();
    await service.manageRecords(async () =>
      createRunRepository(await getDatabase()).deleteAll(true),
    );
  },
};
