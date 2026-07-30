export interface AutoBumperState {
  isActive: boolean;
  bumpsToday: number;
  totalBumpsCount: number;
  lastBumpTime: string;
  nextBumpTime: string;
  intervalHours: number;
  lastBumpStatus: 'Success' | 'Scheduled' | 'Idle';
}

export function getInitialAutoBumperState(): AutoBumperState {
  const now = new Date();
  const nextBump = new Date(now.getTime() + 4 * 60 * 60 * 1000);

  return {
    isActive: true,
    bumpsToday: 18,
    totalBumpsCount: 142,
    lastBumpTime: 'Today at 16:45',
    nextBumpTime: `${nextBump.getHours().toString().padStart(2, '0')}:${nextBump.getMinutes().toString().padStart(2, '0')}`,
    intervalHours: 4,
    lastBumpStatus: 'Success',
  };
}

export function triggerInstantBump(currentState: AutoBumperState): AutoBumperState {
  const now = new Date();
  const nextBump = new Date(now.getTime() + currentState.intervalHours * 60 * 60 * 1000);

  return {
    ...currentState,
    bumpsToday: currentState.bumpsToday + 1,
    totalBumpsCount: currentState.totalBumpsCount + 1,
    lastBumpTime: 'Just now',
    nextBumpTime: `${nextBump.getHours().toString().padStart(2, '0')}:${nextBump.getMinutes().toString().padStart(2, '0')}`,
    lastBumpStatus: 'Success',
  };
}

export function toggleAutoBumper(currentState: AutoBumperState): AutoBumperState {
  return {
    ...currentState,
    isActive: !currentState.isActive,
    lastBumpStatus: !currentState.isActive ? 'Scheduled' : 'Idle',
  };
}
