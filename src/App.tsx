import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  auth, db, signInWithGoogle, 
  onSnapshot, collection, query, where, addDoc, updateDoc, 
  serverTimestamp, doc, setDoc, getDoc, writeBatch, deleteDoc, getDocs, increment
} from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { UserProfile, Bet, GameState, BetStatus } from './types';
import { 
  Trophy, User as UserIcon, LogOut, CheckCircle2, XCircle, 
  Loader2, ShieldCheck, Clock, Ticket, Info, Wallet,
  Calendar, History, Send, CheckCircle, Trash2, Trash, RefreshCw,
  PlusCircle, Target, ArrowUpCircle, Clover
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const VALOR_APOSTA = 10;
const TOTAL_NUMBERS = 25;
const NUMBERS_TO_PICK = 15;
const MIN_HITS_TO_WIN = 12;
const ADMIN_EMAIL = 'tvsonic577@gmail.com';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [myBets, setMyBets] = useState<Bet[]>([]);
  const [view, setView] = useState<'home' | 'bet' | 'history' | 'rules' | 'admin' | 'checkout'>('home');
  const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cpfInput, setCpfInput] = useState('');
  const [whatsappInput, setWhatsappInput] = useState('');
  const [needsProfile, setNeedsProfile] = useState(false);
  const [selectedBetForCheckout, setSelectedBetForCheckout] = useState<Bet | null>(null);

  // 1. Auth & Profile
  useEffect(() => {
    let profileUnsub: (() => void) | null = null;
    const authUnsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Se o e-mail for do admin, tentamos garantir que o doc de usuário exista e tenha a role
        if (u.email === ADMIN_EMAIL) {
          const uRef = doc(db, 'users', u.uid);
          const uSnap = await getDoc(uRef);
          if (!uSnap.exists()) {
            await setDoc(uRef, {
              userId: u.uid,
              name: u.displayName || 'Admin',
              email: u.email,
              role: 'admin',
              updatedAt: serverTimestamp()
            });
          } else if (uSnap.data().role !== 'admin') {
            await updateDoc(uRef, { role: 'admin' });
          }
        }

        profileUnsub = onSnapshot(doc(db, 'users', u.uid), async (snap) => {
          if (snap.exists()) {
            const data = snap.data() as UserProfile;
            setProfile(data);
            
            if (!data.cpf || !data.whatsapp) setNeedsProfile(true);
            else setNeedsProfile(false);
          } else {
            setNeedsProfile(true);
          }
        });
      } else {
        setProfile(null);
        setNeedsProfile(false);
        setLoading(false);
      }
    });
    return () => {
      authUnsub();
      if (profileUnsub) profileUnsub();
    };
  }, []);

  const handleProfileSubmit = async () => {
    if (!user || cpfInput.length < 11 || whatsappInput.length < 10) return;
    setIsSubmitting(true);
    try {
      const role = user.email === ADMIN_EMAIL ? 'admin' : 'user';
      const newProfile: UserProfile = {
        userId: user.uid,
        name: user.displayName || 'Usuário',
        email: user.email || '',
        photoURL: user.photoURL || undefined,
        role,
        cpf: cpfInput,
        whatsapp: whatsappInput,
        updatedAt: serverTimestamp()
      };
      await setDoc(doc(db, 'users', user.uid), newProfile);
      setNeedsProfile(false);
    } catch (e) {
      console.error(e);
      alert('Erro ao salvar perfil.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogoClick = () => {
    setView('home');
    // Force a scroll to top and reset any local states if needed
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // In a real SPA, this is the "Home" button
  };

  const deleteBet = async (betId: string) => {
    if (!confirm('Deseja excluir esta aposta pendente?')) return;
    try {
      // In firestore.rules we should allow delete if owner & pending
      await updateDoc(doc(db, 'bets', betId), { status: 'loser', userId: 'deleted' }); // Hidden way or real delete if rules allowed
      // For now, let's just use a dedicated field to "hide" it if we don't want to change rules right now
      // Better: let's assume valid rules for delete in a moment
    } catch (e) {
      alert('Erro ao excluir aposta.');
    }
  };

  // 2. Global Game State
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'system', 'state'), (snap) => {
      if (snap.exists()) {
        setGameState(snap.data() as GameState);
      } else {
        // Init state - only if admin logs in or we can do it manually
        // For survival, we ensure loading is finished even if it doesn't exist
        setGameState({
          accumulatedPrize: 0,
          currentPool: 0,
          roundNumber: 1,
          updatedAt: new Date()
        });
      }
      setLoading(false);
    }, (err) => {
      console.error("Firebase State Error:", err);
      // Fallback to allow app to load
      setGameState({
        accumulatedPrize: 0,
        currentPool: 0,
        roundNumber: 1,
        updatedAt: new Date()
      });
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const totalPrize = (gameState?.accumulatedPrize || 0) + ((gameState?.currentPool || 0) * 0.8);

  const handleSupportClick = () => {
    window.open('https://wa.me/5562996346075?text=Olá, preciso de suporte com a Loto 12 VIP', '_blank');
  };

  // 3. User Bets
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'bets'),
      where('userId', '==', user.uid)
    );
    return onSnapshot(q, (snap) => {
      setMyBets(snap.docs.map(d => ({ id: d.id, ...d.data() } as Bet)));
    });
  }, [user]);

  const toggleNumber = (n: number) => {
    if (selectedNumbers.includes(n)) {
      setSelectedNumbers(prev => prev.filter(x => x !== n));
    } else if (selectedNumbers.length < NUMBERS_TO_PICK) {
      setSelectedNumbers(prev => [...prev, n].sort((a, b) => a - b));
    }
  };

  const getTime = (val: any) => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    if (typeof val === 'string') return new Date(val).getTime();
    if (typeof val.toMillis === 'function') return val.toMillis();
    if (val.seconds) return val.seconds * 1000;
    return 0;
  };

  const handlePlaceBet = async () => {
    if (!user || selectedNumbers.length !== NUMBERS_TO_PICK || !gameState) return;
    setIsSubmitting(true);
    
    // Capturamos os dados locais para garantir que não usemos referências mutáveis
    const userSnapshot = { uid: user.uid, displayName: user.displayName };
    const currentSelectedNumbers = [...selectedNumbers];
    const currentRound = gameState.roundNumber;
    
    try {
      const serial = `L12-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
      
      const betForDb = {
        serial,
        userId: userSnapshot.uid,
        userName: userSnapshot.displayName || 'Usuário',
        numbers: currentSelectedNumbers,
        status: 'pending' as BetStatus,
        round: currentRound,
        createdAt: serverTimestamp()
      };
      
      const docRef = await addDoc(collection(db, 'bets'), betForDb);
      
      const cleanBet: Bet = {
        id: docRef.id,
        serial,
        userId: userSnapshot.uid,
        userName: userSnapshot.displayName || 'Usuário',
        numbers: currentSelectedNumbers,
        status: 'pending' as BetStatus,
        round: currentRound,
        createdAt: Date.now()
      };

      setSelectedBetForCheckout(cleanBet);
      setView('checkout');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      
      // Limpeza posterior para evitar lag na transição
      setTimeout(() => {
        setSelectedNumbers([]);
        setIsSubmitting(false);
      }, 500);

    } catch (e: any) {
      console.error("ERROR PLACING BET:", e?.message || "Unknown error");
      setIsSubmitting(false);
      alert('Erro ao enviar aposta. Por favor, verifique sua conexão e tente novamente.');
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0a0a0c]">
        <Loader2 className="animate-spin text-indigo-500" size={48} />
      </div>
    );
  }

  if (!user || needsProfile) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-[#0a0a0c] relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-500/20 blur-[120px] rounded-full" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/20 blur-[120px] rounded-full" />
        </div>
        
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="relative z-10 text-center w-full max-w-xs"
        >
          <div className="w-20 h-20 bg-amber-500/10 border border-amber-500/40 rounded-3xl flex items-center justify-center mb-8 mx-auto shadow-[0_0_30px_rgba(251,191,36,0.2)]">
            <Clover className="text-[#FFD700] fill-[#FFD700]/10 drop-shadow-[0_0_15px_rgba(255,215,0,0.5)]" size={44} />
          </div>

          {!user ? (
            <>
              <h1 className="text-5xl font-black text-white mb-2 tracking-tighter">LOTO 12 VIP</h1>
              <p className="text-indigo-200/60 mb-12 text-lg font-medium">
                Sua sorte começa aqui. Ganhe com 12 ou mais acertos.
              </p>
              
              <button 
                onClick={signInWithGoogle}
                className="w-full h-16 bg-white text-black font-black rounded-2xl flex items-center justify-center gap-3 active:scale-95 transition-all shadow-xl hover:shadow-indigo-500/20"
              >
                 <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="google" />
                 ENTRAR COM GOOGLE
              </button>
            </>
          ) : (
            <div className="space-y-6">
              <h1 className="text-3xl font-black text-white tracking-tighter">COMPLETE SEU PERFIL</h1>
              <p className="text-white/40 text-sm font-medium">Precisamos dos seus dados para identificação e contato de ganhadores.</p>
              
              <div className="space-y-4">
                <input 
                  type="number"
                  placeholder="Seu CPF (Somente números)"
                  value={cpfInput}
                  onChange={(e) => setCpfInput(e.target.value.slice(0, 11))}
                  className="w-full h-14 bg-white/5 border border-white/10 rounded-2xl px-6 text-white font-bold outline-none focus:border-indigo-500/50"
                />
                <input 
                  type="tel"
                  placeholder="WhatsApp (Ex: 62999999999)"
                  value={whatsappInput}
                  onChange={(e) => setWhatsappInput(e.target.value.replace(/\D/g, ''))}
                  className="w-full h-14 bg-white/5 border border-white/10 rounded-2xl px-6 text-white font-bold outline-none focus:border-indigo-500/50"
                />
                <button 
                  disabled={cpfInput.length < 11 || whatsappInput.length < 10 || isSubmitting}
                  onClick={handleProfileSubmit}
                  className="w-full h-16 bg-indigo-500 disabled:opacity-50 text-white font-black rounded-2xl active:scale-95 transition-all shadow-lg shadow-indigo-500/20"
                >
                  {isSubmitting ? <Loader2 className="animate-spin mx-auto" /> : "SALVAR E CONTINUAR"}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  const renderHome = () => (
    <div className="space-y-6">
      {/* Prize Card */}
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="relative overflow-hidden p-8 rounded-[2.5rem] bg-gradient-to-br from-indigo-600 via-indigo-700 to-purple-800 shadow-2xl shadow-indigo-500/20 border border-white/20"
      >
        <div className="absolute top-0 right-0 p-4 opacity-10">
          <Trophy size={120} />
        </div>
        <h3 className="text-indigo-200 text-xs font-black uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
          <Trophy size={14} className="animate-pulse" /> PRÊMIO ESTIMADO TOTAL
        </h3>
        <div className="text-5xl font-black text-white mb-6">
          R$ {totalPrize.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        </div>
        <div className="flex gap-4">
          <div className="bg-white/10 backdrop-blur-md rounded-2xl px-4 py-2 border border-white/10">
            <div className="text-[10px] text-white/50 uppercase font-bold tracking-wider">Acumulado</div>
            <div className="text-white font-bold leading-none">R$ {(gameState?.accumulatedPrize || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
          </div>
          <div className="bg-white/10 backdrop-blur-md rounded-2xl px-4 py-2 border border-white/10">
            <div className="text-[10px] text-white/50 uppercase font-bold tracking-wider">Rodada</div>
            <div className="text-white font-bold leading-none">#{gameState?.roundNumber || 1}</div>
          </div>
        </div>
      </motion.div>

      {/* Actions */}
      <div className="grid grid-cols-1 gap-4">
        <button 
          onClick={() => setView('bet')}
          className="group w-full h-20 bg-[#141418] hover:bg-[#1a1a20] border border-white/5 rounded-3xl flex items-center px-6 gap-4 transition-all active:scale-[0.98]"
        >
          <div className="w-12 h-12 bg-indigo-500/10 rounded-2xl flex items-center justify-center group-hover:bg-indigo-500 group-hover:text-white text-indigo-400 transition-colors">
            <PlusCircle size={24} />
          </div>
          <div className="text-left">
            <div className="text-white font-black">FAZER NOVA APOSTA</div>
            <div className="text-white/40 text-[10px] font-bold uppercase tracking-widest">Apenas R$ {VALOR_APOSTA},00</div>
          </div>
        </button>

        <div className="grid grid-cols-2 gap-4">
          <button 
            onClick={() => setView('history')}
            className="p-6 bg-[#141418] hover:bg-[#1a1a20] border border-white/5 rounded-3xl flex flex-col items-center gap-2 transition-all active:scale-[0.98]"
          >
            <Ticket size={24} className="text-purple-400" />
            <span className="text-[10px] font-black tracking-widest text-white/60">MINHAS APOSTAS</span>
          </button>
          <button 
            onClick={() => setView('rules')}
            className="p-6 bg-[#141418] hover:bg-[#1a1a20] border border-white/5 rounded-3xl flex flex-col items-center gap-2 transition-all active:scale-[0.98]"
          >
            <Info size={24} className="text-amber-400" />
            <span className="text-[10px] font-black tracking-widest text-white/60">REGRAS DO JOGO</span>
          </button>
        </div>
      </div>

      {/* Results History (Quick View) */}
      <div className="space-y-4">
        <h4 className="text-xs font-black text-white/40 uppercase tracking-widest px-2">Último Sorteio</h4>
        {gameState?.lastDrawResult ? (
          <div className="bg-[#141418] rounded-3xl p-6 border border-white/5">
            <div className="flex flex-wrap justify-center gap-2">
              {gameState.lastDrawResult.map(n => (
                <div key={n} className="w-8 h-8 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-xs font-bold text-white shadow-lg">
                  {n}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-[#141418] rounded-3xl p-8 border border-white/5 text-center">
            <p className="text-white/30 text-sm font-medium italic">Nenhum sorteio realizado ainda</p>
          </div>
        )}
      </div>
    </div>
  );

  const renderBet = () => (
    <div className="space-y-8 h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-black text-white">Novo Bilhete</h2>
        <div className="flex items-center gap-2 glass-card px-4 py-2 rounded-2xl border border-white/10">
          <span className={cn(
            "text-xs font-black",
            selectedNumbers.length === NUMBERS_TO_PICK ? "text-emerald-400" : "text-white/40"
          )}>
            {selectedNumbers.length}/{NUMBERS_TO_PICK}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1 no-scrollbar">
        <p className="text-white/40 text-sm mb-6 font-medium italic">Selecione exatamente 15 números para participar:</p>
        <div className="grid grid-cols-5 gap-3 pb-8">
          {Array.from({ length: TOTAL_NUMBERS }, (_, i) => i + 1).map(num => {
            const isSelected = selectedNumbers.includes(num);
            return (
              <button
                key={num}
                onClick={() => toggleNumber(num)}
                className={cn(
                  "aspect-square rounded-2xl flex items-center justify-center text-lg font-black transition-all transform active:scale-90 border shadow-lg",
                  isSelected 
                    ? "bg-indigo-600 border-indigo-400 text-white shadow-indigo-500/30 scale-105" 
                    : "bg-[#141418] border-white/5 text-white/50 hover:border-white/20"
                )}
              >
                {num}
              </button>
            );
          })}
        </div>
      </div>

      <div className="pt-4 border-t border-white/5 space-y-4 bg-[#0a0a0c] z-10">
        <button 
          disabled={selectedNumbers.length !== NUMBERS_TO_PICK || isSubmitting}
          onClick={handlePlaceBet}
          className="w-full h-16 bg-emerald-500 disabled:bg-white/5 disabled:text-white/20 text-white font-black rounded-2xl active:scale-95 transition-all shadow-xl shadow-emerald-500/20 flex items-center justify-center gap-2"
        >
          {isSubmitting ? <Loader2 className="animate-spin" /> : <>CONFIRMAR APOSTA • R$ {VALOR_APOSTA}</>}
        </button>
        <button onClick={() => setView('home')} className="w-full h-12 text-white/40 font-bold hover:text-white transition-colors">
          CANCELAR
        </button>
      </div>
    </div>
  );

  const renderHistory = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-black text-white">Minhas Apostas</h2>
        <button onClick={() => setView('bet')} className="text-[10px] font-black text-indigo-400 bg-indigo-500/10 px-4 py-2 rounded-xl">NOVA APOSTA</button>
      </div>
      <div className="space-y-4 pb-20">
        {myBets.length === 0 ? (
          <div className="bg-[#141418] rounded-3xl p-12 text-center border border-white/5">
            <Ticket size={48} className="mx-auto text-white/10 mb-4" />
            <p className="text-white/40 font-medium">Você ainda não fez nenhuma aposta.</p>
          </div>
        ) : (
          [...myBets].sort((a, b) => getTime(b.createdAt) - getTime(a.createdAt)).map(bet => (
            <div key={bet.id} className="bg-[#141418] p-6 rounded-3xl border border-white/5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <History size={14} className="text-indigo-400" />
                    <span className="text-[10px] font-black text-white/40 tracking-widest leading-none">SÉRIE: {bet.serial}</span>
                  </div>
                  <span className="text-xs font-black text-white/60 mt-1">TICKET #{bet.id?.slice(-6).toUpperCase()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-[10px] font-black px-3 py-1 rounded-lg uppercase tracking-wider flex items-center gap-1.5",
                    bet.status === 'pending' ? "bg-amber-500/10 text-amber-500 cursor-pointer" :
                    bet.status === 'active' ? "bg-indigo-500/10 text-indigo-400" :
                    bet.status === 'winner' ? "bg-emerald-500/10 text-emerald-400 font-black animate-pulse" :
                    "bg-red-500/10 text-red-500"
                  )}
                  onClick={() => {
                    if (bet.status === 'pending') {
                      setSelectedBetForCheckout(bet);
                      setView('checkout');
                    }
                  }}
                  >
                    {bet.status === 'pending' ? 'Pagar Agora' : 
                     bet.status === 'active' ? 'Ativo' : 
                     bet.status === 'winner' ? (
                       <>Ganhador! {gameState?.lastPrizePerWinner ? `(+R$ ${gameState.lastPrizePerWinner.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})` : ''}</>
                     ) : 'Perdedor'}
                  </span>
                  {bet.status === 'pending' && bet.id && (
                    <button 
                      onClick={() => deleteBet(bet.id!)}
                      className="p-1.5 text-red-400/50 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {bet.numbers.map(n => (
                  <div key={n} className="w-7 h-7 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-[10px] font-bold text-white/80">
                    {n}
                  </div>
                ))}
              </div>
              {bet.hits !== undefined && (
                <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                  <span className="text-xs text-white/40 font-medium">Total de Acertos:</span>
                  <span className="text-sm font-black text-indigo-400">{bet.hits} Acertos</span>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderCheckout = () => (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="text-center">
        <div className="w-20 h-20 bg-indigo-500/10 rounded-[2.5rem] flex items-center justify-center mx-auto mb-4 border border-indigo-500/20">
          <Wallet className="text-indigo-500" size={32} />
        </div>
        <h2 className="text-3xl font-black text-white tracking-tighter">Checkout</h2>
        <p className="text-white/40 text-sm">Realize o pagamento para ativar sua aposta.</p>
      </div>

      <div className="bg-[#141418] rounded-[2.5rem] p-8 border border-white/5 space-y-6">
        <div className="flex justify-between items-center pb-6 border-b border-white/5">
          <div className="text-left">
            <div className="text-[10px] text-white/40 font-black uppercase tracking-widest">Valor do Jogo</div>
            <div className="text-2xl font-black text-white">R$ {VALOR_APOSTA},00</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-white/40 font-black uppercase tracking-widest">Série</div>
            <div className="text-sm font-black text-indigo-400">{selectedBetForCheckout?.serial}</div>
          </div>
        </div>

        <div className="space-y-4">
          <h4 className="text-xs font-black text-white/60 uppercase tracking-widest text-center">Formas de Pagamento</h4>
          <a 
            href="https://mpago.la/1anBvFU" 
            target="_blank" 
            rel="noreferrer"
            className="w-full block"
          >
            <button className="w-full h-16 bg-white text-black font-black rounded-2xl flex items-center justify-between px-6 active:scale-95 transition-all outline-none">
              <span>PIX COPIA E COLA</span>
              <ArrowUpCircle size={20} className="rotate-90" />
            </button>
          </a>
          <div className="bg-indigo-500/5 p-8 rounded-[2rem] border border-indigo-500/20 text-center">
             <div className="text-white font-black text-xs space-y-3">
                <p className="text-indigo-400 text-[10px] tracking-widest uppercase">Regra de Ativação</p>
                <p className="leading-relaxed text-sm">
                  TIRE PRINT DESTA TELA E ENVIE NO SUPORTE COM O COMPROVANTE DE PIX PARA LIBERAÇÃO DA CARTELA!
                </p>
             </div>
          </div>
        </div>
      </div>

      <div className="bg-indigo-500/10 p-6 rounded-3xl border border-indigo-500/20 flex gap-4">
        <div className="text-indigo-400 shrink-0"><Info size={20} /></div>
        <p className="text-[11px] text-indigo-200/70 font-medium leading-relaxed">
          Após realizar o PIX, sua aposta será validada automaticamente em até 5 minutos pela nossa equipe financeira.
        </p>
      </div>

      <button 
        onClick={() => setView('history')}
        className="w-full h-16 border border-white/10 rounded-2xl text-white/60 font-black tracking-widest hover:text-white transition-all active:scale-95"
      >
        VOLTAR PARA MINHAS APOSTAS
      </button>
    </div>
  );

  const renderRules = () => (
    <div className="space-y-8">
      <h2 className="text-3xl font-black text-white tracking-tighter">Regras Oficiais</h2>
      
      <div className="space-y-4">
        {[
          { icon: <Target className="text-indigo-400" />, title: "O Jogo", desc: "Escolha 15 números entre 1 e 25 por bilhete." },
          { icon: <Trophy className="text-emerald-400" />, title: "Premiação", desc: `Ganham todos que acertarem ${MIN_HITS_TO_WIN} ou mais números do sorteio.` },
          { icon: <ArrowUpCircle className="text-purple-400" />, title: "Acúmulo", desc: "Caso não haja ganhadores na rodada, 80% do prêmio acumula para o próximo sorteio." },
          { icon: <Wallet className="text-amber-400" />, title: "Divisão", desc: "20% do valor arrecadado é destinado à manutenção e operações do sistema." },
          { icon: <Clock className="text-blue-400" />, title: "Confirmação", desc: "Toda aposta deve ser aprovada pela administração após o pagamento." }
        ].map((rule, i) => (
          <div key={i} className="flex gap-6 p-6 bg-[#141418] rounded-[2rem] border border-white/5">
            <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center shrink-0">
              {rule.icon}
            </div>
            <div>
              <h4 className="text-white font-black mb-1">{rule.title}</h4>
              <p className="text-white/50 text-sm leading-relaxed">{rule.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="p-8 bg-indigo-500/10 border border-indigo-500/20 rounded-[2.5rem] text-center">
        <p className="text-indigo-200 text-sm font-medium mb-6">Ficou com alguma dúvida?</p>
        <button 
          onClick={handleSupportClick}
          className="w-full h-14 bg-indigo-500 rounded-2xl text-white font-black tracking-wide shadow-lg shadow-indigo-500/20 active:scale-95 transition-all"
        >
          SUPORTE VIP NO WHATSAPP
        </button>
      </div>
    </div>
  );

  const renderAdmin = () => {
    if (profile?.role !== 'admin') return null;
    return <AdminPanel onClose={() => setView('home')} gameState={gameState} />;
  };

  return (
    <div className="flex-1 flex flex-col bg-[#0a0a0c] text-white overflow-hidden max-w-md mx-auto w-full relative">
      <header className="flex items-center justify-between p-6 pt-10 shrink-0">
        <button onClick={handleLogoClick} className="flex items-center gap-3 text-left">
          <div className="w-10 h-10 rounded-xl overflow-hidden glass-card flex items-center justify-center border border-white/10 shrink-0 bg-amber-500/10 shadow-[0_0_15px_rgba(251,191,36,0.1)]">
            <Clover size={22} className="text-[#FFD700] fill-[#FFD700]/10 drop-shadow-[0_0_8px_rgba(255,215,0,0.4)]" />
          </div>
          <div>
            <div className="text-[10px] text-white/40 font-black uppercase tracking-widest leading-none mb-1">Loteria VIP</div>
            <div className="text-sm font-bold text-white leading-none tracking-tighter">LOTO 12 VIP</div>
          </div>
        </button>
        <div className="flex items-center gap-2">
          {profile?.role === 'admin' && (
            <button 
              onClick={() => setView('admin')}
              className={cn(
                "p-2 rounded-xl transition-all active:scale-90 border",
                view === 'admin' ? "bg-indigo-500 text-white border-indigo-400" : "bg-white/5 text-indigo-400 border-white/10"
              )}
            >
              <ShieldCheck size={20} />
            </button>
          )}
          <button onClick={() => auth.signOut()} className="p-2 bg-white/5 border border-white/10 rounded-xl text-white/40 hover:text-red-400 hover:bg-red-400/10 transition-all active:scale-90">
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-6 pb-24 no-scrollbar">
        <div className="h-full animate-in fade-in duration-500">
            {view === 'home' && renderHome()}
            {view === 'bet' && renderBet()}
            {view === 'history' && renderHistory()}
            {view === 'rules' && renderRules()}
            {view === 'checkout' && renderCheckout()}
            {view === 'admin' && renderAdmin()}
        </div>
      </main>

      {/* Bottom Nav Sidebar for mobile to avoid covering buttons */}
      {view !== 'admin' && view !== 'bet' && view !== 'checkout' && (
        <nav className="fixed right-4 bottom-24 flex flex-col gap-4 z-40">
          <button 
            onClick={() => setView('bet')} 
            className="w-14 h-14 bg-emerald-500 rounded-2xl flex items-center justify-center text-white shadow-2xl shadow-emerald-500/40 border-2 border-[#0a0a0c] active:scale-90 transition-all group"
          >
            <PlusCircle size={28} />
            <div className="absolute right-16 bg-[#141418] px-3 py-1.5 rounded-lg border border-white/10 text-[10px] font-black text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none uppercase tracking-widest">
              Jogar Agora
            </div>
          </button>
          <button 
            onClick={() => setView('history')} 
            className={cn(
              "w-14 h-14 rounded-2xl flex items-center justify-center shadow-2xl border-2 border-[#0a0a0c] active:scale-90 transition-all group",
              view === 'history' ? "bg-indigo-500 text-white" : "bg-[#141418] text-white/40 border-white/5"
            )}
          >
            <Ticket size={24} />
            <div className="absolute right-16 bg-[#141418] px-3 py-1.5 rounded-lg border border-white/10 text-[10px] font-black text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none uppercase tracking-widest">
              Meus Jogos
            </div>
          </button>
          <button 
            onClick={() => setView('home')} 
            className={cn(
              "w-14 h-14 rounded-2xl flex items-center justify-center shadow-2xl border-2 border-[#0a0a0c] active:scale-90 transition-all group",
              view === 'home' ? "bg-indigo-500 text-white" : "bg-[#141418] text-white/40 border-white/5"
            )}
          >
            <Target size={24} />
            <div className="absolute right-16 bg-[#141418] px-3 py-1.5 rounded-lg border border-white/10 text-[10px] font-black text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none uppercase tracking-widest">
              Dashboard
            </div>
          </button>
        </nav>
      )}
    </div>
  );
}

// Separate management components
const AdminPanel = ({ onClose, gameState }: { onClose: () => void; gameState: GameState | null }) => {
  const [bets, setBets] = useState<Bet[]>([]);
  const [activeTab, setActiveTab] = useState<'pending' | 'draw' | 'stats'>('pending');
  const [resultInput, setResultInput] = useState<string>('');
  const [bonusInput, setBonusInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [usersCpfMap, setUsersCpfMap] = useState<Record<string, string>>({});
  const [usersEmailMap, setUsersEmailMap] = useState<Record<string, string>>({});
  const [usersWhatsappMap, setUsersWhatsappMap] = useState<Record<string, string>>({});

  useEffect(() => {
    const q = query(collection(db, 'bets'));
    const unsubBets = onSnapshot(q, (snap) => {
      setBets(snap.docs.map(d => ({ id: d.id, ...d.data() } as Bet)));
    });

    const usersUnsub = onSnapshot(collection(db, 'users'), (snap) => {
      const cpfMap: Record<string, string> = {};
      const emailMap: Record<string, string> = {};
      const whatsappMap: Record<string, string> = {};
      snap.docs.forEach(d => {
        const data = d.data();
        if (data.userId) {
          if (data.cpf) cpfMap[data.userId] = data.cpf;
          if (data.email) emailMap[data.userId] = data.email;
          if (data.whatsapp) whatsappMap[data.userId] = data.whatsapp;
        }
      });
      setUsersCpfMap(cpfMap);
      setUsersEmailMap(emailMap);
      setUsersWhatsappMap(whatsappMap);
    });

    return () => {
      unsubBets();
      usersUnsub();
    };
  }, []);

  const handleApprove = async (id: string) => {
    if (!gameState) return;
    const bet = bets.find(b => b.id === id);
    if (!bet) return;
    
    setIsProcessing(true);
    try {
      await updateDoc(doc(db, 'bets', id), { status: 'active' });
      await updateDoc(doc(db, 'system', 'state'), {
        currentPool: increment(VALOR_APOSTA)
      });
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async (id: string) => {
    await updateDoc(doc(db, 'bets', id), { status: 'loser' }); // or delete
  };

  const handleAddBonus = async () => {
    if (!gameState) {
      alert('Aguarde o carregamento dos dados...');
      return;
    }
    
    const cleanInput = bonusInput.replace(/\./g, '').replace(',', '.');
    const amount = parseFloat(cleanInput);
    
    if (isNaN(amount) || amount <= 0) {
      alert('Valor inválido. Use formato como 100 ou 100,00');
      return;
    }

    setIsProcessing(true);
    try {
      const stateRef = doc(db, 'system', 'state');
      
      // Garantir que o valor inicial seja numérico se estiver nulo/indefinido
      const currentAcc = gameState.accumulatedPrize || 0;
      
      await setDoc(stateRef, {
        accumulatedPrize: increment(amount),
        updatedAt: serverTimestamp()
      }, { merge: true });
      
      setBonusInput('');
      alert(`SUCESSO! Novo saldo bônus adicionado: R$ ${amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\nO prêmio total foi atualizado.`);
    } catch (e: any) {
      console.error("ERRO FIREBASE:", e);
      alert('ERRO AO ADICIONAR: ' + (e.message || 'Erro de permissão ou conexão.'));
    } finally {
      setIsProcessing(false);
    }
  };

  const processDraw = async () => {
    if (!gameState) {
      alert('Aguarde o carregamento do sistema...');
      return;
    }

    const nums = resultInput.trim().split(/[\s,]+/).map(n => parseInt(n)).filter(n => !isNaN(n) && n >= 1 && n <= 25);
    const sortedResult = Array.from(new Set(nums)).sort((a: number, b: number) => a - b);

    if (sortedResult.length !== 15) {
      alert(`Você inseriu ${sortedResult.length} números únicos válidos. São necessários exatamente 15.`);
      return;
    }

    if (!window.confirm('CONFIRMAR SORTEIO E FINALIZAR RODADA? Esta ação irá conferir todas as apostas e distribuir os prêmios conforme anunciado.')) return;

    setIsProcessing(true);
    console.log("INICIANDO FINALIZAÇÃO DE RODADA...");
    console.log("Resultado sorteado:", sortedResult);
    
    try {
      const currentRound = gameState.roundNumber || 1;
      console.log("Processando Rodada:", currentRound);

      // Pegamos todas as apostas da rodada atual que estão pendentes ou ativas
      const activeBets = bets.filter(b => b.round === currentRound && (b.status === 'active' || b.status === 'pending'));
      
      console.log(`Encontradas ${activeBets.length} apostas para processar.`);

      const currentPoolSize = gameState.currentPool || 0;
      const houseFee = currentPoolSize * 0.2;
      const roundPrize = currentPoolSize - houseFee;
      
      // O prêmio TOTAL da rodada é o que foi arrecadado (menos 20%) + o que estava acumulado
      const baseAccumulated = gameState.accumulatedPrize || 0;
      const totalPrizePool = roundPrize + baseAccumulated;

      console.log("Prêmio Base Acumulado:", baseAccumulated);
      console.log("Arrecadação Líquida da Rodada:", roundPrize);
      console.log("Prêmio Total Disponível:", totalPrizePool);

      const winners: any[] = [];
      const drawResults: { id: string, hits: number, status: BetStatus }[] = [];

      activeBets.forEach(bet => {
        // Ignorar se não tiver números (segurança)
        if (!bet.numbers) return;
        
        const hits = bet.numbers.filter(n => sortedResult.includes(n)).length;
        const status = hits >= MIN_HITS_TO_WIN ? 'winner' : 'loser';
        
        drawResults.push({ id: bet.id!, hits, status });
        
        if (status === 'winner') {
          winners.push({ id: bet.id!, userId: bet.userId, hits });
        }
      });
      
      console.log(`Ganhadores: ${winners.length}`);

      // 1. Atualizar todas as apostas
      const BATCH_SIZE = 450; 
      for (let i = 0; i < drawResults.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = drawResults.slice(i, i + BATCH_SIZE);
        chunk.forEach(res => {
          batch.update(doc(db, 'bets', res.id), { status: res.status, hits: res.hits });
        });
        await batch.commit();
      }

      // 2. Definir novo estado
      const stateRef = doc(db, 'system', 'state');
      const totalWinners = winners.length;
      
      // Se houver ganhadores, o prêmio é dividido. Se não, TUDO acumula.
      let newAccumulated = 0;
      let prizePerWinner = 0;

      if (totalWinners > 0) {
        prizePerWinner = totalPrizePool / totalWinners;
        newAccumulated = 0; // Zerado pois foi distribuído
      } else {
        prizePerWinner = 0;
        newAccumulated = totalPrizePool; // Acumula o prêmio total para a próxima
      }

      await setDoc(stateRef, {
        lastDrawResult: sortedResult,
        accumulatedPrize: newAccumulated,
        currentPool: 0,
        roundNumber: currentRound + 1,
        lastPrizePerWinner: prizePerWinner,
        lastWinnersCount: totalWinners,
        lastTotalPrize: totalPrizePool,
        updatedAt: serverTimestamp(),
        lastUpdate: new Date().toISOString()
      }, { merge: true });

      setResultInput('');
      
      let message = totalWinners > 0 
        ? `RODADA FINALIZADA COM SUCESSO!\n\n${totalWinners} ganhador(es) encontrado(s).\nCada um receberá R$ ${prizePerWinner.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.\n\nO prêmio para a próxima rodada começa zerado (R$ 0,00).`
        : `RODADA FINALIZADA!\n\nNinguém acertou ${MIN_HITS_TO_WIN}+ pontos.\nO prêmio de R$ ${totalPrizePool.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} foi ACUMULADO para a próxima rodada!`;

      alert(message);
      window.location.reload(); 
    } catch (e: any) {
      console.error("Erro no sorteio:", e);
      alert('ERRO AO FINALIZAR RODADA: ' + (e.message || 'Verifique se você é o administrador autorizado.'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClearBets = async () => {
    if (!window.confirm('Deseja APAGAR TODAS AS APOSTAS? Esta ação removerá permanentemente as apostas do banco de dados, mas NÃO resetará o prêmio acumulado nem a rodada atual.')) return;
    setIsProcessing(true);
    try {
      const allBetsIds = bets.map(b => b.id).filter((id): id is string => !!id);
      const BATCH_SIZE = 450;
      for (let i = 0; i < allBetsIds.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = allBetsIds.slice(i, i + BATCH_SIZE);
        chunk.forEach(id => batch.delete(doc(db, 'bets', id)));
        await batch.commit();
      }
      alert('TODAS AS APOSTAS FORAM APAGADAS!');
    } catch (e: any) {
      console.error("Erro no clear:", e);
      alert('ERRO: ' + (e.message || 'Erro de conexão/permissão.'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('ATENÇÃO: Deseja ZERAR TODO O SISTEMA? Isso apagará TODAS as apostas de todas as rodadas e resetará o acumulado para R$ 0,00.')) return;
    setIsProcessing(true);
    try {
      const allBetsIds = bets.map(b => b.id).filter((id): id is string => !!id);
      const BATCH_SIZE = 450;
      for (let i = 0; i < allBetsIds.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = allBetsIds.slice(i, i + BATCH_SIZE);
        chunk.forEach(id => batch.delete(doc(db, 'bets', id)));
        await batch.commit();
      }

      await setDoc(doc(db, 'system', 'state'), {
        currentPool: 0,
        accumulatedPrize: 0,
        roundNumber: 1,
        lastDrawResult: null,
        lastPrizePerWinner: 0,
        updatedAt: serverTimestamp()
      }, { merge: true });

      alert('SISTEMA RESETADO COM SUCESSO!');
    } catch (e: any) {
      console.error("Erro no reset:", e);
      alert('ERRO AO ZERAR SISTEMA: ' + (e.message || 'Verifique se você é o administrador autorizado.'));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <motion.div 
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      className="fixed inset-0 z-50 bg-[#0a0a0c] flex flex-col p-6"
    >
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tighter">Painel ADM</h2>
          <p className="text-white/40 text-[10px] font-black uppercase tracking-widest">Gestão do Bolão VIP</p>
        </div>
        <button onClick={onClose} className="p-3 bg-white/5 border border-white/10 rounded-2xl text-white/50">
          <XCircle size={24} />
        </button>
      </div>

      <div className="flex gap-2 mb-8 bg-[#141418] p-1.5 rounded-2xl border border-white/5">
        {[
          { id: 'pending', label: 'Pendentes', icon: <Clock size={14} /> },
          { id: 'draw', label: 'Sorteio', icon: <Target size={14} /> },
          { id: 'stats', label: 'Estatísticas', icon: <History size={14} /> }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={cn(
              "flex-1 h-12 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all",
              activeTab === tab.id ? "bg-indigo-500 text-white shadow-lg" : "text-white/40 hover:text-white"
            )}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar pb-10">
        {activeTab === 'pending' && (
          <div className="space-y-4">
            {bets.filter(b => b.status === 'pending').length === 0 ? (
              <div className="py-20 text-center opacity-30 italic text-sm">Nenhuma aposta pendente</div>
            ) : (
              bets.filter(b => b.status === 'pending').map(bet => (
                <div key={bet.id} className="bg-[#141418] border border-white/5 rounded-3xl p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400 font-bold text-xs uppercase">
                        {bet.userName[0]}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white leading-none">{bet.userName}</div>
                        <div className="text-[9px] text-white/30 lowercase mt-0.5">{usersEmailMap[bet.userId] || 'sem e-mail'}</div>
                        <div className="text-[10px] text-white/40 uppercase font-black tracking-widest mt-1">
                          CPF: {usersCpfMap[bet.userId] || 'N/A'} • SÉRIE: {bet.serial}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {bet.numbers.map(n => (
                      <span key={n} className="w-6 h-6 rounded-md bg-white/5 border border-white/10 flex items-center justify-center text-[10px] text-white/60">{n}</span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleApprove(bet.id!)}
                      className="flex-1 h-12 bg-emerald-500 rounded-xl text-white text-[10px] font-black uppercase tracking-widest"
                    >
                      APROVAR
                    </button>
                    <button 
                      onClick={() => handleReject(bet.id!)}
                      className="flex-1 h-12 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl text-[10px] font-black uppercase tracking-widest"
                    >
                      RECUSAR
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'draw' && (() => {
          const previewNums = resultInput.trim().split(/[\s,]+/).map(n => parseInt(n)).filter(n => !isNaN(n) && n >= 1 && n <= 25);
          const sortedPreview = Array.from(new Set(previewNums)).sort((a: number, b: number) => a - b);
          const activeBetsForRound = bets.filter(b => b.status === 'active' && b.round === gameState?.roundNumber);
          
          return (
            <div className="space-y-6">
              <div className="bg-[#141418] border border-white/5 rounded-[2.5rem] p-8 mb-6">
                <h4 className="text-white font-black mb-4">Saldo Bônus</h4>
                <p className="text-white/40 text-[10px] mb-4 uppercase tracking-widest">Aumente o prêmio acumulado desta rodada</p>
                <div className="flex gap-4">
                  <div className="relative flex-1">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20 font-black text-xs">R$</span>
                    <input 
                      type="text" 
                      value={bonusInput}
                      onChange={(e) => setBonusInput(e.target.value)}
                      placeholder="0,00"
                      className="w-full h-14 bg-white/5 border border-white/10 rounded-2xl px-12 text-white font-bold outline-none focus:border-indigo-500 transition-all text-sm"
                    />
                  </div>
                  <button 
                    disabled={isProcessing}
                    onClick={handleAddBonus}
                    className="h-14 px-6 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-20 text-white font-black rounded-2xl flex items-center gap-2 transition-all text-[10px] uppercase tracking-widest whitespace-nowrap"
                  >
                    {isProcessing ? <Loader2 className="animate-spin" size={16} /> : <><PlusCircle size={16} /> Adicionar</>}
                  </button>
                </div>
              </div>

              <div className="bg-[#141418] border border-white/5 rounded-[2.5rem] p-8">
                <div className="flex items-center justify-between mb-6">
                  <h4 className="text-white font-black">Novo Sorteio</h4>
                  <div className="px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-full text-[10px] font-black text-indigo-400 uppercase tracking-widest">
                    Rodada #{gameState?.roundNumber}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                    <div className="text-[9px] text-white/40 font-black uppercase tracking-widest mb-1">Apostas Ativas</div>
                    <div className="text-xl font-black text-white">{activeBetsForRound.length}</div>
                  </div>
                  <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                    <div className="text-[9px] text-white/40 font-black uppercase tracking-widest mb-1">Arrecadação (100%)</div>
                    <div className="text-xl font-black text-white">R$ {(gameState?.currentPool || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                    <div className="text-[9px] text-white/40 font-black uppercase tracking-widest mb-1">Saldo Bônus</div>
                    <div className="text-xl font-black text-blue-400">R$ {(gameState?.accumulatedPrize || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                    <div className="text-[9px] text-white/40 font-black uppercase tracking-widest mb-1">Prêmio Estimado</div>
                    <div className="text-xl font-black text-emerald-400">R$ {(((gameState?.currentPool || 0) * 0.8) + (gameState?.accumulatedPrize || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                  </div>
                </div>

                <div className="flex items-center justify-between mb-4">
                  <p className="text-white/40 text-xs uppercase tracking-widest font-black">Conferência de Resultado</p>
                  <div className={cn(
                    "px-3 py-1 rounded text-[10px] font-black",
                    sortedPreview.length === 15 ? "bg-emerald-500/20 text-emerald-400" : "bg-white/5 text-white/30"
                  )}>
                    {sortedPreview.length}/15 NÚMEROS
                  </div>
                </div>
                
                <textarea 
                  value={resultInput}
                  onChange={(e) => setResultInput(e.target.value)}
                  placeholder="Cole aqui os 15 números sorteados..."
                  className={cn(
                    "w-full h-32 bg-white/5 border rounded-2xl p-4 text-sm font-mono text-white outline-none transition-all mb-6",
                    sortedPreview.length === 15 ? "border-emerald-500/50" : "border-white/10 focus:border-indigo-500/50"
                  )}
                />

                {sortedPreview.length > 0 && (
                  <div className="mb-6 p-4 bg-indigo-500/5 border border-indigo-500/10 rounded-2xl">
                    <div className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2">Números Identificados ({sortedPreview.length})</div>
                    <div className="flex flex-wrap gap-1">
                      {sortedPreview.map(n => (
                        <span key={n} className="w-8 h-8 rounded-lg bg-indigo-500 text-white flex items-center justify-center text-xs font-bold shadow-lg shadow-indigo-500/20">{n}</span>
                      ))}
                    </div>
                  </div>
                )}

                {sortedPreview.length === 15 && (
                  <div className="mb-6 space-y-3">
                    <div className="text-[10px] font-black text-emerald-400 uppercase tracking-widest px-2">Conferência em Tempo Real</div>
                    <div className="bg-black/20 rounded-2xl overflow-hidden border border-white/5">
                      {activeBetsForRound.length === 0 ? (
                        <div className="p-4 text-white/30 text-xs italic text-center">Nenhuma aposta ativa para conferir</div>
                      ) : (
                        <div className="divide-y divide-white/5 max-h-60 overflow-y-auto">
                          {(() => {
                            const totalPool = (gameState?.currentPool || 0) * 0.8 + (gameState?.accumulatedPrize || 0);
                            const previewWinners = activeBetsForRound.filter(b => b.numbers.filter(n => sortedPreview.includes(n)).length >= MIN_HITS_TO_WIN);
                            const prizePerHead = previewWinners.length > 0 ? totalPool / previewWinners.length : totalPool;
                            
                            return activeBetsForRound.map(bet => {
                              const hits = bet.numbers.filter(n => sortedPreview.includes(n)).length;
                              const isWinner = hits >= MIN_HITS_TO_WIN;
                              return (
                                <div key={bet.id} className="p-4 flex items-center justify-between border-l-4 border-transparent hover:border-indigo-500 transition-all bg-white/5 mb-1 rounded-r-xl">
                                  <div>
                                    <div className="text-white font-bold text-xs flex items-center gap-2">
                                      {bet.userName}
                                      <span className="text-[9px] font-normal text-white/30 lowercase italic">
                                        {usersEmailMap[bet.userId] || 'sem e-mail'} • {usersWhatsappMap[bet.userId] || 'sem whats'}
                                      </span>
                                    </div>
                                    <div className="text-[10px] text-indigo-400/60 font-black tracking-widest mt-0.5 uppercase">
                                      SÉRIE: {bet.serial} 
                                      {isWinner && (
                                        <span className="ml-2 text-emerald-400">
                                          • GANHOU: R$ {prizePerHead.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className={cn(
                                    "px-3 py-1 rounded-lg text-xs font-black shrink-0 ml-4 transition-all duration-500",
                                    isWinner ? "bg-emerald-500 text-white animate-pulse scale-105 shadow-lg shadow-emerald-500/20" : "bg-white/5 text-white/40"
                                  )}>
                                    {hits} ACERTOS
                                  </div>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <button 
                  disabled={isProcessing || sortedPreview.length !== 15}
                  onClick={processDraw}
                  className="w-full h-16 bg-indigo-500 disabled:opacity-30 text-white font-black rounded-2xl shadow-xl shadow-indigo-500/20 active:scale-95 transition-all flex items-center justify-center gap-3"
                >
                  {isProcessing ? <Loader2 className="animate-spin" /> : <><Target /> CONFIRMAR E FINALIZAR RODADA</>}
                </button>
              </div>

              <div className="p-4 grid grid-cols-2 gap-4">
                <button 
                  disabled={isProcessing}
                  onClick={handleClearBets}
                  className="flex items-center justify-center gap-2 text-white/40 hover:text-white border border-white/5 hover:bg-white/5 font-bold text-[10px] uppercase tracking-widest p-4 rounded-2xl transition-all"
                >
                  {isProcessing ? <Loader2 className="animate-spin" size={14} /> : <><Trash size={14} /> Apagar Apostas</>}
                </button>
                <button 
                  disabled={isProcessing}
                  onClick={handleReset}
                  className="flex items-center justify-center gap-2 text-red-500/50 hover:text-red-500 border border-red-500/10 hover:bg-red-500/5 font-bold text-[10px] uppercase tracking-widest p-4 rounded-2xl transition-all"
                >
                  {isProcessing ? <Loader2 className="animate-spin" size={14} /> : <><Trash2 size={14} /> Zerar Sistema</>}
                </button>
              </div>
            </div>
          )
        })()}

        {activeTab === 'stats' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[#141418] p-6 rounded-3xl border border-white/5 text-center">
                <div className="text-[10px] text-white/40 font-black uppercase tracking-widest mb-1">Apostas Ativas</div>
                <div className="text-3xl font-black text-white">{bets.filter(b => b.status === 'active' && b.round === gameState?.roundNumber).length}</div>
              </div>
              <div className="bg-[#141418] p-6 rounded-3xl border border-white/5 text-center">
                <div className="text-[10px] text-white/40 font-black uppercase tracking-widest mb-1">Usuários</div>
                <div className="text-3xl font-black text-white">{(new Set(bets.map(b => b.userId))).size}</div>
              </div>
            </div>
            
            <div className="bg-[#141418] p-8 rounded-[2.5rem] border border-white/5">
              <h4 className="text-white font-black mb-6">Arrecadação Total</h4>
              <div className="space-y-4">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-white/40">Total em Jogo</span>
                  <span className="font-bold">R$ {((gameState?.currentPool || 0) + (gameState?.accumulatedPrize || 0)).toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-white/40">Comissão Sistema (20%)</span>
                  <span className="font-bold text-amber-500">R$ {((gameState?.currentPool || 0) * 0.2).toFixed(2)}</span>
                </div>
                <div className="h-px bg-white/5" />
                <div className="flex justify-between items-center">
                  <span className="text-white/60 font-medium">Líquido Premiável</span>
                  <span className="text-xl font-black text-emerald-400">R$ {(((gameState?.currentPool || 0) * 0.8) + (gameState?.accumulatedPrize || 0)).toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="bg-[#141418] p-8 rounded-[2.5rem] border border-white/5">
              <h4 className="text-white font-black mb-6">Lista de Participantes ({bets.filter(b => b.status === 'active' && b.round === gameState?.roundNumber).length})</h4>
              <div className="space-y-3 max-h-96 overflow-y-auto no-scrollbar">
                {bets.filter(b => b.status === 'active' && b.round === gameState?.roundNumber).map(bet => (
                  <div key={bet.id} className="p-4 bg-white/5 rounded-2xl border border-white/5">
                    <div className="flex items-center justify-between mb-2">
                       <div className="text-xs font-bold text-white">{bet.userName}</div>
                       <div className="text-[10px] text-indigo-400 font-bold tracking-widest leading-none">SÉRIE: {bet.serial}</div>
                    </div>
                    <div className="text-[9px] text-white/30 lowercase mb-2">
                      {usersEmailMap[bet.userId] || 'sem e-mail'} • {usersWhatsappMap[bet.userId] || 'sem whats'} • {usersCpfMap[bet.userId] || 'sem CPF'}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {bet.numbers.map(n => (
                        <span key={n} className="w-5 h-5 rounded bg-white/10 text-white flex items-center justify-center text-[8px] font-bold">{n}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};
