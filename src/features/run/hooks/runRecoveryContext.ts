import { createContext } from 'react';
import type { useRunBootstrap } from './useRunBootstrap';

export const RunRecoveryContext = createContext<ReturnType<typeof useRunBootstrap> | null>(null);
