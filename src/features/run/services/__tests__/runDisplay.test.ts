import { formatDistance, formatDuration, formatPace, formatRunDate } from '../runDisplay';
it('시간은 분:초와 시:분:초를 표시한다', () => { expect(formatDuration(65_999)).toBe('1:05'); expect(formatDuration(3_661_000)).toBe('1:01:01'); });
it('0km와 측정 불가 페이스를 표시한다', () => { expect(formatDistance(0)).toBe('0.00'); expect(formatDistance(1234)).toBe('1.23'); expect(formatPace(null)).toBe(`--'--"`); expect(formatPace(300)).toBe('5:00'); });
it('날짜 포맷터는 유효한 저장 시각을 표시한다', () => { expect(formatRunDate(0)).toContain('1970'); });
