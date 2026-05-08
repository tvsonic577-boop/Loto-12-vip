export type UserRole = 'user' | 'admin';
export type BetStatus = 'pending' | 'active' | 'winner' | 'loser';

export interface UserProfile {
  userId: string;
  name: string;
  email: string;
  cpf?: string;
  whatsapp?: string;
  photoURL?: string;
  role: UserRole;
  updatedAt: any;
}

export interface Bet {
  id?: string;
  serial: string;
  userId: string;
  userName: string;
  numbers: number[];
  status: BetStatus;
  hits?: number;
  round: number;
  createdAt: any;
}

export interface GameState {
  accumulatedPrize: number;
  currentPool: number;
  roundNumber: number;
  lastDrawResult?: number[];
  lastPrizePerWinner?: number;
  updatedAt: any;
}
