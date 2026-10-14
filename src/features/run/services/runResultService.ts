import { createRunLocationRepository } from '@/database/repositories/runLocationRepository';
import { getDatabase } from '@/database/database';
import { createRunRepository } from '@/database/repositories/runRepository';

export async function getCompletedRun(id: string) {
  const record = await createRunRepository(await getDatabase()).findById(id);
  if (!record || record.status !== 'completed') throw new Error('완료된 기록을 찾을 수 없어요.');
  return record;
}

export async function getRunPath(id: string) {
  return (await createRunLocationRepository(await getDatabase()).listForRun(id)).map((point) => ({
    latitude: point.latitude,
    longitude: point.longitude,
    timestampMs: point.recordedAtMs,
    segmentId: point.segmentIndex,
  }));
}
