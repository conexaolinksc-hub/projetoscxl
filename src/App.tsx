import React, { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';

import {
  onAuthStateChanged,
  signInAnonymously,
  signInWithCustomToken,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  type User
} from 'firebase/auth';


import {

  collection,
  doc,
  setDoc,

  onSnapshot,
  writeBatch,
  updateDoc,
  getDoc,
  arrayUnion
} from 'firebase/firestore';
import {
  Plus,
  Trash2,

  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Layout,
  Search,
  Settings,
  X,
  Square,
  CheckSquare,
  PanelLeftClose,
  PanelLeftOpen,
  CalendarDays,

  Download,


  ArrowRight,

  Lock,


  Check,

  Pin,
  User as UserIcon,
  Users,
  PlusCircle,

  LogOut,

  Eye,
  Mail,
  UserPlus,
  LogIn
} from 'lucide-react';

import { auth, db, appId } from './config/firebase';

declare var __initial_auth_token: string | undefined;

// --- Constantes Visuais ---
const ROW_HEIGHT = 64;
const DAY_WIDTH = 50;

// --- Tipos e Interfaces ---
interface StatusConfig { id: string; label: string; colorClass: string; pinned?: boolean; }
type DiasUteis = number[];

interface Tarefa {
  id: string;
  titulo: string;
  responsaveis?: string[];
  responsavel?: string;
  duracaoEstimada: number;
  constraintDate?: string;
  constraintType?: 'ASAP' | 'MSO' | 'SNET';
  diasUteis?: DiasUteis;
  dependencias?: string[];
  inicio: string;
  fim: string;
  status: string;
  descricao?: string;
  concluido?: boolean;
  createdAt?: number;
  fimOriginal?: string;
  duracaoOriginal?: number;
  isDelayedByDeps?: boolean;
}

interface TeamSettings {
  allowedEmails: string[];
}

interface TeamInvite {
  adminId: string;
  adminName: string;
}

interface Notification { message: string; type: 'error' | 'success' | 'warning' | 'info'; }
interface DeleteState { type: 'task' | 'status'; id: string; }

// --- Opções ---
const WEEK_DAYS_CONFIG = [
  { id: 0, label: 'Dom', longLabel: 'Domingo' },
  { id: 1, label: 'Seg', longLabel: 'Segunda' },
  { id: 2, label: 'Ter', longLabel: 'Terça' },
  { id: 3, label: 'Qua', longLabel: 'Quarta' },
  { id: 4, label: 'Qui', longLabel: 'Quinta' },
  { id: 5, label: 'Sex', longLabel: 'Sexta' },
  { id: 6, label: 'Sáb', longLabel: 'Sábado' },
];

const DEFAULT_WORKING_DAYS = [0, 1, 2, 3, 4, 5, 6];

const DEFAULT_STATUSES: StatusConfig[] = [
  { id: 'pendente', label: 'Pendente', colorClass: 'bg-slate-100 text-slate-600 border-slate-200', pinned: true },
  { id: 'em_andamento', label: 'Em Andamento', colorClass: 'bg-blue-50 text-blue-600 border-blue-200', pinned: true },
  { id: 'concluido', label: 'Concluído', colorClass: 'bg-emerald-50 text-emerald-600 border-emerald-200', pinned: false },
];

// --- MOTOR DE CÁLCULO GANTT ---
const normalizeDate = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const parseDate = (str: string) => {
  if (!str) return normalizeDate(new Date());
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const formatDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const isWorkDay = (date: Date, workDays: number[]) => workDays.includes(date.getDay());

const getNextWorkDay = (date: Date, workDays: number[]): Date => {
  if (workDays.length === 0) return date;
  let d = new Date(date);
  let safety = 0;
  while (!isWorkDay(d, workDays) && safety < 30) {
    d.setDate(d.getDate() + 1);
    safety++;
  }
  return d;
};

const calendarAdd = (startDate: Date, duration: number, workDays: number[]): Date => {
  if (duration <= 0) return startDate;
  let current = new Date(startDate);

  if (workDays.length > 0 && !isWorkDay(current, workDays)) {
    current = getNextWorkDay(current, workDays);
  }

  let daysToAdd = Math.max(1, duration) - 1;
  let safety = 0;

  while (daysToAdd > 0 && safety < 5000) {
    current.setDate(current.getDate() + 1);
    if (workDays.length === 0 || isWorkDay(current, workDays)) {
      daysToAdd--;
    }
    safety++;
  }
  return current;
};

const calculateDuration = (startDate: Date, endDate: Date, workDays: number[]): number => {
  let count = 0;
  let current = new Date(startDate);
  current.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  if (end < current) return 1;

  while (current <= end) {
    if (workDays.includes(current.getDay())) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  return Math.max(1, count);
};

const detectCycle = (tasks: Map<string, Tarefa>): boolean => {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  const dfs = (taskId: string): boolean => {
    visited.add(taskId);
    recursionStack.add(taskId);

    const task = tasks.get(taskId);
    if (task?.dependencias) {
      for (const depId of task.dependencias) {
        if (!visited.has(depId)) {
          if (dfs(depId)) return true;
        } else if (recursionStack.has(depId)) {
          return true; // Ciclo detectado
        }
      }
    }
    recursionStack.delete(taskId);
    return false;
  };

  for (const taskId of tasks.keys()) {
    if (!visited.has(taskId)) {
      if (dfs(taskId)) return true;
    }
  }
  return false;
};

const topologicalSort = (tasks: Map<string, Tarefa>): string[] => {
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (taskId: string) => {
    if (visited.has(taskId)) return;
    visited.add(taskId);

    const task = tasks.get(taskId);
    if (task?.dependencias) {
      for (const depId of task.dependencias) {
        if (tasks.has(depId)) visit(depId);
      }
    }
    stack.push(taskId);
  };

  for (const taskId of tasks.keys()) {
    visit(taskId);
  }

  return stack;
};

const runSchedulingEngine = (allTasks: Tarefa[]): Tarefa[] => {
  const taskMap = new Map<string, Tarefa>();
  allTasks.forEach(t => taskMap.set(t.id, { ...t }));

  if (detectCycle(taskMap)) {
    throw new Error("Ciclo de dependência detectado! Verifique as conexões.");
  }

  const sortedIds = topologicalSort(taskMap);
  const updatedTasks: Tarefa[] = [];

  for (const taskId of sortedIds) {
    const task = taskMap.get(taskId);
    if (!task) continue;

    const workDays = task.diasUteis || DEFAULT_WORKING_DAYS;

    let candidateStartDates: number[] = [];
    let constraintTime = 0;

    if (task.constraintDate) {
      constraintTime = parseDate(task.constraintDate).getTime();
      candidateStartDates.push(constraintTime);
    } else {
      if ((!task.dependencias || task.dependencias.length === 0)) {
        candidateStartDates.push(parseDate(task.inicio || formatDate(new Date())).getTime());
      }
    }

    if (task.dependencias) {
      for (const depId of task.dependencias) {
        const predecessor = taskMap.get(depId);
        if (predecessor) {
          const predEnd = parseDate(predecessor.fim);
          const nextDay = new Date(predEnd);
          nextDay.setDate(nextDay.getDate() + 1);
          candidateStartDates.push(nextDay.getTime());
        }
      }
    }

    const maxTime = Math.max(...candidateStartDates);
    let earlyStart = new Date(maxTime);

    if (workDays.length > 0 && !isWorkDay(earlyStart, workDays)) {
      earlyStart = getNextWorkDay(earlyStart, workDays);
    }

    const earlyFinish = calendarAdd(earlyStart, task.duracaoEstimada, workDays);

    task.inicio = formatDate(earlyStart);
    task.fim = formatDate(earlyFinish);
    task.isDelayedByDeps = constraintTime > 0 && earlyStart.getTime() > constraintTime;

    updatedTasks.push(task);
  }

  return updatedTasks;
};

const sanitizeEmailForId = (email: string) => {
  return email.replace(/[^a-zA-Z0-9]/g, '_');
};

// --- Componente Principal ---
export default function MarketingProjectManager() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [statusList, setStatusList] = useState<StatusConfig[]>([]);

  // Modais
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);

  // Estado de Edição
  const [editingTask, setEditingTask] = useState<Tarefa | null>(null);

  // Campos do Formulário
  const [formStart, setFormStart] = useState('');
  const [formDuration, setFormDuration] = useState(1);
  const [formEnd, setFormEnd] = useState('');
  const [formDiasUteis, setFormDiasUteis] = useState<number[]>(DEFAULT_WORKING_DAYS);
  const [formStatus, setFormStatus] = useState('pendente');
  const [formDeps, setFormDeps] = useState<string[]>([]);
  const [formResponsaveis, setFormResponsaveis] = useState<string[]>([]);
  const [isConstraintActive, setIsConstraintActive] = useState(false);

  // Estados de Interface
  const [activeRespSelector, setActiveRespSelector] = useState<string | null>(null);
  const [newRespInputValue, setNewRespInputValue] = useState('');
  const [isRespDropdownOpen, setIsRespDropdownOpen] = useState(false);
  const [notification, setNotification] = useState<Notification | null>(null);
  const [itemToDelete, setItemToDelete] = useState<DeleteState | null>(null);
  const [ganttStartDate, setGanttStartDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // --- Sistema de Equipe e Auth ---
  const [viewMode, setViewMode] = useState<'admin' | 'member'>('admin');
  const [connectedTeamId, setConnectedTeamId] = useState<string>('');
  const [teamCodeInput, setTeamCodeInput] = useState('');

  // Gestão de Emails Permitidos (Admin)
  const [allowedEmails, setAllowedEmails] = useState<string[]>([]);
  const [newEmailInput, setNewEmailInput] = useState('');

  // Gestão de Convites Recebidos (Membro)
  const [myInvites, setMyInvites] = useState<TeamInvite[]>([]);

  const ganttContainerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const hasInitialScrolled = useRef(false);

  // Refs para click outside
  const respSelectorRef = useRef<HTMLDivElement>(null);
  const respDropdownRef = useRef<HTMLDivElement>(null);

  // --- Hooks e Computações ---

  const workspaceId = useMemo(() => {
    if (viewMode === 'member' && connectedTeamId) {
      return connectedTeamId;
    }
    return user?.uid;
  }, [user, viewMode, connectedTeamId]);

  const canEditProject = viewMode === 'admin';

  const uniqueResponsibles = useMemo(() => {
    const names = new Set<string>();
    tarefas.forEach(t => {
      if (t.responsaveis && Array.isArray(t.responsaveis)) {
        t.responsaveis.forEach(r => names.add(r));
      } else if (t.responsavel) {
        names.add(t.responsavel);
      }
    });
    return Array.from(names).sort();
  }, [tarefas]);

  const filteredTarefas = useMemo(() => {
    let filtered = tarefas.filter(t => {
      const matchTitle = t.titulo.toLowerCase().includes(searchTerm.toLowerCase());
      const resps = t.responsaveis || (t.responsavel ? [t.responsavel] : []);
      const matchResp = resps.some(r => r.toLowerCase().includes(searchTerm.toLowerCase()));
      return matchTitle || matchResp;
    });
    filtered.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return filtered;
  }, [tarefas, searchTerm]);

  const diasGantt = useMemo(() => {
    const dias = [];
    const current = new Date(ganttStartDate);
    current.setDate(current.getDate() - 2);
    const end = new Date(ganttStartDate);
    end.setMonth(end.getMonth() + 6);
    while (current <= end) {
      dias.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    return dias;
  }, [ganttStartDate]);

  const monthsHeader = useMemo(() => {
    const months: { label: string; days: number }[] = [];
    if (!diasGantt.length) return months;
    let currM = diasGantt[0].getMonth(), currY = diasGantt[0].getFullYear(), count = 0;
    diasGantt.forEach(d => {
      if (d.getMonth() !== currM || d.getFullYear() !== currY) {
        months.push({ label: new Date(currY, currM, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }), days: count });
        currM = d.getMonth(); currY = d.getFullYear(); count = 0;
      }
      count++;
    });
    months.push({ label: new Date(currY, currM, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }), days: count });
    return months;
  }, [diasGantt]);

  const todayPos = useMemo(() => {
    const now = new Date();
    const idx = diasGantt.findIndex(d => d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear());
    if (idx === -1) return null;
    const hourPct = (now.getHours() * 60 + now.getMinutes()) / 1440;
    return (idx * DAY_WIDTH) + (hourPct * DAY_WIDTH);
  }, [diasGantt]);

  // --- Efeitos ---

  // Efeito de Autenticação
  useEffect(() => {
    const initAuth = async () => {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        try {
          await signInWithCustomToken(auth, __initial_auth_token);
        } catch (e) {
          console.error("Erro no token inicial.");
        }
      }
      setAuthLoading(false);
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Busca Convites Públicos para o Membro
  useEffect(() => {
    if (!user || !user.email) {
      setMyInvites([]);
      return;
    }

    // Procura convites usando o email sanitizado como ID
    const sanitizedEmail = sanitizeEmailForId(user.email.toLowerCase());
    const inviteDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'invites', sanitizedEmail);

    const unsubInvites = onSnapshot(inviteDocRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data && Array.isArray(data.teams)) {
          setMyInvites(data.teams);
        } else {
          setMyInvites([]);
        }
      } else {
        setMyInvites([]);
      }
    });

    return () => unsubInvites();
  }, [user]);

  // Efeito de Carregamento de Dados
  useEffect(() => {
    if (!workspaceId) return;

    if (viewMode === 'member' && !connectedTeamId) {
      setTarefas([]);
      return;
    }

    const tasksQuery = collection(db, 'artifacts', appId, 'users', workspaceId, 'tasks');
    const unsubTasks = onSnapshot(tasksQuery, (snapshot) => {
      setTarefas(snapshot.docs.map(d => d.data() as Tarefa));
    }, (error) => {
      console.error(error);
      if (viewMode === 'member') {
        showNotification("Acesso negado ou erro ao conectar.", 'error');
        handleLeaveTeam();
      }
    });

    const statusDocRef = doc(db, 'artifacts', appId, 'users', workspaceId, 'settings', 'statuses');
    const unsubStatus = onSnapshot(statusDocRef, (docSnap) => {
      if (docSnap.exists()) setStatusList(docSnap.data()?.list || DEFAULT_STATUSES);
      else {
        if (canEditProject) setDoc(statusDocRef, { list: DEFAULT_STATUSES });
        setStatusList(DEFAULT_STATUSES);
      }
    });

    let unsubTeamSettings = () => { };
    if (viewMode === 'admin') {
      const teamSettingsRef = doc(db, 'artifacts', appId, 'users', workspaceId, 'settings', 'team');
      unsubTeamSettings = onSnapshot(teamSettingsRef, (snap) => {
        if (snap.exists()) {
          setAllowedEmails(snap.data().allowedEmails || []);
        } else {
          setAllowedEmails([]);
        }
      });
    }

    return () => { unsubTasks(); unsubStatus(); unsubTeamSettings(); };
  }, [workspaceId, viewMode, connectedTeamId, canEditProject]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (respSelectorRef.current && !respSelectorRef.current.contains(event.target as Node)) {
        setActiveRespSelector(null);
        setNewRespInputValue('');
      }
      if (respDropdownRef.current && !respDropdownRef.current.contains(event.target as Node)) {
        setIsRespDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useLayoutEffect(() => {
    if (!ganttContainerRef.current || !diasGantt.length) return;
    if (!hasInitialScrolled.current && todayPos !== null) {
      ganttContainerRef.current.scrollLeft = Math.max(0, todayPos - 50);
      hasInitialScrolled.current = true;
    }
  }, [todayPos, diasGantt]);

  // --- Helper Functions ---

  const showNotification = (message: string, type: 'error' | 'success' | 'warning' | 'info' = 'error') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  };

  const getStatusConfig = (id: string) => statusList.find(s => s.id === id) || DEFAULT_STATUSES[0];

  const getDaysDiff = (dateA: Date, dateB: Date) => {
    const utcA = Date.UTC(dateA.getFullYear(), dateA.getMonth(), dateA.getDate());
    const utcB = Date.UTC(dateB.getFullYear(), dateB.getMonth(), dateB.getDate());
    return Math.floor((utcB - utcA) / (1000 * 60 * 60 * 24));
  };

  const getBarGeo = (s: string, f: string) => {
    if (!diasGantt.length) return { x: 0, w: 0 };
    const startIdx = getDaysDiff(diasGantt[0], parseDate(s));
    const dur = getDaysDiff(parseDate(s), parseDate(f)) + 1;
    return { x: startIdx * DAY_WIDTH, w: dur * DAY_WIDTH };
  };

  // --- Handlers de Ação ---

  const handleLoginGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error("Login Error:", error);
      if (error.code === 'auth/operation-not-allowed' || error.code === 'auth/unauthorized-domain') {
        showNotification("Login Google não configurado no painel Firebase. Usando modo Demo.", 'warning');
        await signInAnonymously(auth);
      } else {
        showNotification("Erro ao logar com Google. Tente novamente.", 'error');
      }
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setViewMode('admin');
    setConnectedTeamId('');
    setTarefas([]);
    setMyInvites([]);
  };

  const handleAddAllowedEmail = async () => {
    if (!newEmailInput || !newEmailInput.includes('@') || !user) return;
    const email = newEmailInput.trim().toLowerCase();

    if (allowedEmails.includes(email)) {
      showNotification("Email já está na lista.", 'warning');
      return;
    }

    const updatedList = [...allowedEmails, email];
    const teamSettingsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'team');

    // Sanitiza email para criar ID público
    const sanitizedEmail = sanitizeEmailForId(email);
    const publicInviteRef = doc(db, 'artifacts', appId, 'public', 'data', 'invites', sanitizedEmail);

    const inviteData: TeamInvite = {
      adminId: user.uid,
      adminName: user.displayName || user.email || 'Admin'
    };

    try {
      // 1. Atualiza lista privada (controle do admin)
      await setDoc(teamSettingsRef, { allowedEmails: updatedList }, { merge: true });

      // 2. Atualiza documento público de convites (visível pelo membro)
      // Usamos setDoc com merge para não apagar convites de outros admins
      await setDoc(publicInviteRef, {
        teams: arrayUnion(inviteData)
      }, { merge: true });

      setAllowedEmails(updatedList);
      setNewEmailInput('');
      showNotification("Membro convidado com sucesso.", 'success');
    } catch (e) {
      console.error(e);
      showNotification("Erro ao convidar membro.", 'error');
    }
  };

  const handleRemoveAllowedEmail = async (email: string) => {
    if (!user) return;
    const updatedList = allowedEmails.filter(e => e !== email);
    const teamSettingsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'team');

    const sanitizedEmail = sanitizeEmailForId(email);
    const publicInviteRef = doc(db, 'artifacts', appId, 'public', 'data', 'invites', sanitizedEmail);

    try {
      // Remover do doc público: lê, filtra e reescreve
      const snap = await getDoc(publicInviteRef);
      if (snap.exists()) {
        const currentTeams = snap.data().teams as TeamInvite[];
        const newTeams = currentTeams.filter(t => t.adminId !== user.uid);
        // merge: true mantém outros campos se existirem, mas substitui 'teams'
        await setDoc(publicInviteRef, { teams: newTeams }, { merge: true });
      }

      await setDoc(teamSettingsRef, { allowedEmails: updatedList }, { merge: true });
      showNotification("Acesso do membro revogado.", 'info');
    } catch (e) {
      showNotification("Erro ao remover.", 'error');
    }
  };

  const handleJoinTeam = async (targetId: string, teamName?: string) => {
    if (targetId.length < 5) {
      showNotification("ID inválido.", 'warning');
      return;
    }

    if (targetId === user?.uid) {
      showNotification("Você não pode entrar na sua própria equipe como membro.", 'warning');
      return;
    }

    try {
      const teamSettingsRef = doc(db, 'artifacts', appId, 'users', targetId, 'settings', 'team');
      const snap = await getDoc(teamSettingsRef);

      let isAllowed = false;
      if (user?.isAnonymous) {
        isAllowed = true;
        showNotification("Modo Demo: Acesso permitido.", 'info');
      } else if (snap.exists()) {
        const data = snap.data() as TeamSettings;
        const userEmail = user?.email?.toLowerCase();
        if (data.allowedEmails && userEmail && data.allowedEmails.includes(userEmail)) {
          isAllowed = true;
        }
      }

      if (isAllowed) {
        setConnectedTeamId(targetId);
        setViewMode('member');
        setIsTeamModalOpen(false);
        setTeamCodeInput('');
        showNotification(teamName ? `Bem-vindo à equipe de ${teamName}!` : "Conectado à equipe!", 'success');
      } else {
        showNotification("Acesso Negado: Seu email não está na lista desta equipe.", 'error');
      }

    } catch (e) {
      console.error(e);
      showNotification("Erro ao verificar permissões.", 'error');
    }
  };

  const handleLeaveTeam = () => {
    setViewMode('admin');
    setConnectedTeamId('');
    showNotification("Desconectado da equipe.", 'info');
  };

  const openNewTask = () => {
    if (!canEditProject) return;
    setEditingTask(null);
    const today = formatDate(new Date());
    setFormStart(today);
    setFormDuration(3);
    const end = calendarAdd(parseDate(today), 3, DEFAULT_WORKING_DAYS);
    setFormEnd(formatDate(end));
    setFormDiasUteis(DEFAULT_WORKING_DAYS);
    setFormStatus('pendente');
    setFormDeps([]);
    setFormResponsaveis([]);
    setIsConstraintActive(false);
    setIsModalOpen(true);
  };

  const openEditTask = (task: Tarefa) => {
    setEditingTask(task);
    setFormStart(task.constraintDate || task.inicio);
    setFormDuration(task.duracaoEstimada || 1);
    setFormEnd(task.fim);
    setFormDiasUteis(task.diasUteis || DEFAULT_WORKING_DAYS);
    setFormStatus(task.status);
    setFormDeps(task.dependencias || []);
    const currentResps = task.responsaveis || (task.responsavel ? [task.responsavel] : []);
    setFormResponsaveis(currentResps);
    setIsConstraintActive(!!task.constraintDate || (!task.dependencias || task.dependencias.length === 0));
    setIsModalOpen(true);
  };

  const handleDependencyClick = (task: Tarefa) => {
    if (!canEditProject) return;
    if (formDeps.includes(task.id)) {
      setFormDeps(formDeps.filter(id => id !== task.id));
    } else {
      setFormDeps([...formDeps, task.id]);
    }
  };

  const handleStartDateChange = (val: string) => {
    setFormStart(val);
    if (val && formDuration > 0) {
      const end = calendarAdd(parseDate(val), formDuration, formDiasUteis);
      setFormEnd(formatDate(end));
    }
  };

  const handleDurationChange = (val: number) => {
    setFormDuration(val);
    if (formStart && val > 0) {
      const end = calendarAdd(parseDate(formStart), val, formDiasUteis);
      setFormEnd(formatDate(end));
    }
  };

  const handleEndDateChange = (val: string) => {
    setFormEnd(val);
    if (val && formStart) {
      const start = parseDate(formStart);
      const end = parseDate(val);
      if (end >= start) {
        const newDur = calculateDuration(start, end, formDiasUteis);
        setFormDuration(newDur);
      }
    }
  };

  const handleWorkingDaysChange = (dayId: number) => {
    if (!canEditProject) return;
    const isSelected = formDiasUteis.includes(dayId);
    const newDays = isSelected
      ? formDiasUteis.filter(x => x !== dayId)
      : [...formDiasUteis, dayId].sort();

    setFormDiasUteis(newDays);
    if (formStart && formDuration > 0) {
      const end = calendarAdd(parseDate(formStart), formDuration, newDays);
      setFormEnd(formatDate(end));
    }
  };

  const handleSaveTask = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!workspaceId) return;

    if (viewMode === 'member') {
      if (editingTask && formStatus !== editingTask.status) {
        handleChangeStatus(editingTask.id, formStatus);
        setIsModalOpen(false);
        return;
      } else {
        setIsModalOpen(false);
        return;
      }
    }

    const formData = new FormData(e.currentTarget);
    const taskId = editingTask ? editingTask.id : crypto.randomUUID();

    const hasDeps = formDeps.length > 0;
    const finalConstraintDate = (isConstraintActive || !hasDeps) ? formStart : '';

    const baseTarefa: Tarefa = {
      id: taskId,
      titulo: formData.get('titulo') as string,
      responsaveis: formResponsaveis,
      duracaoEstimada: formDuration,
      constraintDate: finalConstraintDate,
      constraintType: 'SNET',
      diasUteis: formDiasUteis,
      status: formStatus,
      descricao: formData.get('descricao') as string,
      concluido: editingTask ? editingTask.concluido : false,
      dependencias: formDeps,
      createdAt: editingTask?.createdAt ?? Date.now(),
      inicio: formStart || formatDate(new Date()),
      fim: formStart || formatDate(new Date()),
      fimOriginal: editingTask?.fimOriginal,
      duracaoOriginal: editingTask?.duracaoOriginal
    };

    const allTasks = [...tarefas.filter(t => t.id !== taskId), baseTarefa];

    try {
      const recalculatedTasks = runSchedulingEngine(allTasks);
      const batch = writeBatch(db);
      recalculatedTasks.forEach((task) => {
        const docRef = doc(db, 'artifacts', appId, 'users', workspaceId, 'tasks', task.id);
        const cleanTask = JSON.parse(JSON.stringify(task));
        batch.set(docRef, cleanTask);
      });

      await batch.commit();
      setIsModalOpen(false);
      showNotification("Projeto salvo com sucesso!", 'success');
    } catch (e: any) {
      console.error(e);
      showNotification(e.message || "Erro no cálculo.", 'error');
    }
  };

  const handleChangeStatus = async (taskId: string, newStatus: string) => {
    if (!workspaceId) return;
    const task = tarefas.find(t => t.id === taskId);
    if (!task) return;

    if (newStatus === 'concluido' && task.status !== 'concluido') {
      const todayStr = formatDate(new Date());
      let updatedTask = { ...task, status: newStatus, concluido: true, fimOriginal: task.fim, duracaoOriginal: task.duracaoEstimada };

      const start = parseDate(task.inicio);
      const end = parseDate(todayStr);
      if (end >= start) {
        updatedTask.fim = todayStr;
        updatedTask.duracaoEstimada = calculateDuration(start, end, task.diasUteis || DEFAULT_WORKING_DAYS);
      }

      const allTasks = tarefas.map(t => t.id === taskId ? updatedTask : t);
      try {
        const recalculatedTasks = runSchedulingEngine(allTasks);
        const batch = writeBatch(db);
        recalculatedTasks.forEach((t) => {
          const docRef = doc(db, 'artifacts', appId, 'users', workspaceId, 'tasks', t.id);
          const cleanTask = JSON.parse(JSON.stringify(t));
          batch.set(docRef, cleanTask);
        });
        await batch.commit();
        showNotification("Status atualizado para Concluído!", 'success');
      } catch (e) {
        showNotification("Erro ao atualizar.", 'error');
      }
    } else {
      let updatedTask = { ...task, status: newStatus, concluido: false };
      if (task.concluido && task.fimOriginal && task.duracaoOriginal) {
        updatedTask.fim = task.fimOriginal;
        updatedTask.duracaoEstimada = task.duracaoOriginal;
        delete updatedTask.fimOriginal;
        delete updatedTask.duracaoOriginal;
      }

      const allTasks = tarefas.map(t => t.id === taskId ? updatedTask : t);
      try {
        const recalculatedTasks = runSchedulingEngine(allTasks);
        const batch = writeBatch(db);
        recalculatedTasks.forEach((t) => {
          const docRef = doc(db, 'artifacts', appId, 'users', workspaceId, 'tasks', t.id);
          const cleanTask = JSON.parse(JSON.stringify(t));
          batch.set(docRef, cleanTask);
        });
        await batch.commit();
      } catch (e) {
        console.error(e);
      }
    }
  };

  const handleUpdateResponsibles = async (taskId: string, newResps: string[]) => {
    if (!workspaceId || !canEditProject) return;
    const taskRef = doc(db, 'artifacts', appId, 'users', workspaceId, 'tasks', taskId);
    await updateDoc(taskRef, { responsaveis: newResps, responsavel: newResps[0] || '' });
  };

  const toggleConcluido = async (id: string) => {
    const task = tarefas.find(t => t.id === id);
    if (task) {
      handleChangeStatus(id, task.status === 'concluido' ? 'pendente' : 'concluido');
    }
  };

  const handleDeleteRequest = (type: 'task' | 'status', id: string) => {
    if (!canEditProject) return;
    setItemToDelete({ type, id });
  };

  const confirmDelete = async () => {
    if (!itemToDelete || !workspaceId || !canEditProject) return;

    if (itemToDelete.type === 'task') {
      const idToDelete = itemToDelete.id;
      let remainingTasks = tarefas.filter(t => t.id !== idToDelete);

      remainingTasks = remainingTasks.map(t => {
        if (t.dependencias && t.dependencias.includes(idToDelete)) {
          return {
            ...t,
            dependencias: t.dependencias.filter(dId => dId !== idToDelete)
          };
        }
        return t;
      });

      try {
        const recalculatedTasks = runSchedulingEngine(remainingTasks);
        const batch = writeBatch(db);
        const docToDelete = doc(db, 'artifacts', appId, 'users', workspaceId, 'tasks', idToDelete);
        batch.delete(docToDelete);

        recalculatedTasks.forEach(t => {
          const docRef = doc(db, 'artifacts', appId, 'users', workspaceId, 'tasks', t.id);
          const cleanTask = JSON.parse(JSON.stringify(t));
          batch.set(docRef, cleanTask);
        });

        await batch.commit();
        showNotification("Item excluído.", 'success');
      } catch (e: any) {
        showNotification(e.message, 'error');
      }

    } else {
      const path = ['settings', itemToDelete.type === 'status' ? 'statuses' : 'categories'];
      const list = itemToDelete.type === 'status' ? statusList : [];
      await setDoc(doc(db, 'artifacts', appId, 'users', workspaceId, ...path), { list: list.filter(x => x.id !== itemToDelete.id) });
    }
    setItemToDelete(null);
  };

  // --- Renderização Condicional da Tela de Login ---
  if (!user && !authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center border border-slate-100">
          <div className="bg-indigo-600 w-16 h-16 rounded-xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-indigo-200">
            <Layout size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Conexão Link Projetos</h1>
          <p className="text-slate-500 mb-8">Gerencie seus projetos e colabore com sua equipe de forma simples.</p>

          <button
            onClick={handleLoginGoogle}
            className="w-full bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium py-3 px-4 rounded-xl flex items-center justify-center gap-3 transition-all shadow-sm hover:shadow-md"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Entrar com Google
          </button>
          <p className="mt-6 text-xs text-slate-400">
            Ambiente seguro autenticado pelo Google Firebase.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col overflow-hidden">
      {notification && (
        <div className={`fixed bottom-6 right-6 z-[100] px-4 py-3 rounded-lg border border-slate-200 shadow-lg bg-white flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4`}>
          <div className={`w-2 h-2 rounded-full ${notification.type === 'error' ? 'bg-red-500' : notification.type === 'warning' ? 'bg-orange-500' : notification.type === 'info' ? 'bg-blue-500' : 'bg-emerald-500'}`}></div>
          <span className="text-sm font-medium">{notification.message}</span>
          <button onClick={() => setNotification(null)} className="ml-auto opacity-50 hover:opacity-100"><X size={16} /></button>
        </div>
      )}

      {itemToDelete && (
        <div className="fixed inset-0 z-[110] bg-black/20 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white p-6 rounded-xl w-full max-w-sm text-center border border-slate-200 shadow-xl">
            <h3 className="text-lg font-bold mb-2 text-slate-800">Confirmar exclusão?</h3>
            <p className="text-sm text-slate-500 mb-6">Dependências associadas serão removidas.</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setItemToDelete(null)} className="px-4 py-2 border border-slate-200 rounded-lg text-slate-600 font-medium hover:bg-slate-50 transition-colors">Cancelar</button>
              <button onClick={confirmDelete} className="px-4 py-2 bg-red-600 rounded-lg text-white font-medium hover:bg-red-700 transition-colors shadow-sm">Excluir</button>
            </div>
          </div>
        </div>
      )}

      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg text-white shadow-sm"><Layout size={24} /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 tracking-tight leading-tight">Projetos Conexão Link</h1>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${viewMode === 'admin' ? 'bg-slate-100 text-slate-600' : 'bg-orange-100 text-orange-700'}`}>
                {viewMode === 'admin' ? 'Administrador' : 'Membro da Equipe'}
              </span>
              {viewMode === 'member' && (
                <span className="text-[10px] text-slate-400 font-mono">ID: {connectedTeamId.slice(0, 6)}...</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden md:flex flex-col items-end mr-2">
            <span className="text-xs font-bold text-slate-700">{user?.displayName || user?.email || 'Usuário'}</span>
            <span onClick={handleLogout} className="text-[10px] text-slate-400 cursor-pointer hover:text-red-500 hover:underline">Sair</span>
          </div>
          {user?.photoURL ? (
            <img src={user.photoURL} className="w-8 h-8 rounded-full border border-slate-200" alt="Avatar" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-xs">{user?.email?.[0]?.toUpperCase() || 'U'}</div>
          )}

          <div className="h-8 w-px bg-slate-200 mx-1"></div>

          <button
            onClick={() => setIsTeamModalOpen(true)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${viewMode === 'member' ? 'bg-orange-50 text-orange-700 hover:bg-orange-100 border border-orange-200' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'} ${myInvites.length > 0 && viewMode === 'admin' ? 'ring-2 ring-indigo-200 ring-offset-1' : ''}`}
          >
            <Users size={16} />
            {viewMode === 'member' ? 'Equipe' : 'Acesso'}
            {myInvites.length > 0 && viewMode === 'admin' && (
              <span className="absolute top-3 right-[180px] w-2.5 h-2.5 bg-red-500 rounded-full border border-white"></span>
            )}
          </button>

          <div className="relative w-48 hidden lg:block">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
            <input type="text" placeholder="Buscar..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 transition-all font-medium placeholder:text-slate-400" />
          </div>
          {viewMode === 'admin' && (
            <button onClick={() => setIsSettingsModalOpen(true)} className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-lg transition-all"><Settings size={20} /></button>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-hidden p-6 flex flex-col gap-4">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col flex-1 overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-white rounded-t-xl">
            <div className="flex items-center gap-2">
              <button onClick={() => { const d = new Date(ganttStartDate); d.setMonth(d.getMonth() - 1); setGanttStartDate(d); }} className="p-1.5 hover:bg-slate-50 border border-slate-200 rounded-lg text-slate-600 transition-all"><ChevronLeft size={20} /></button>
              <span className="font-bold text-slate-800 min-w-[180px] text-center text-lg capitalize">{ganttStartDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</span>
              <button onClick={() => { const d = new Date(ganttStartDate); d.setMonth(d.getMonth() + 1); setGanttStartDate(d); }} className="p-1.5 hover:bg-slate-50 border border-slate-200 rounded-lg text-slate-600 transition-all"><ChevronRight size={20} /></button>
              <button onClick={() => { setGanttStartDate(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())); hasInitialScrolled.current = false; }} className="ml-4 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm font-medium flex items-center gap-2 text-slate-600 hover:bg-slate-50 transition-all"><CalendarDays size={16} /> Hoje</button>
            </div>
          </div>
          <div ref={ganttContainerRef} className="flex-1 overflow-auto relative custom-scrollbar select-none rounded-b-xl"
            onMouseDown={e => { setIsDragging(true); setStartX(e.pageX - ganttContainerRef.current!.offsetLeft); setScrollLeft(ganttContainerRef.current!.scrollLeft); }}
            onMouseMove={e => { if (!isDragging) return; e.preventDefault(); const x = e.pageX - ganttContainerRef.current!.offsetLeft; ganttContainerRef.current!.scrollLeft = scrollLeft - (x - startX); }}
            onMouseUp={() => setIsDragging(false)} onMouseLeave={() => setIsDragging(false)}>
            <div className="min-w-max">
              <div className="flex flex-col sticky top-0 z-30 bg-white">
                <div className="flex bg-white border-b border-slate-100">
                  <div className={`${isSidebarOpen ? 'w-64' : 'w-12'} flex-shrink-0 border-r border-slate-100 sticky left-0 z-40 bg-white flex items-center justify-center p-2 transition-all`}>
                    {isSidebarOpen ? (
                      canEditProject ? (
                        <button onClick={openNewTask} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-1.5 rounded-lg shadow-sm text-xs font-bold uppercase tracking-wide flex items-center justify-center gap-2 transition-all">
                          <Plus size={14} /> Novo Projeto
                        </button>
                      ) : (
                        <div className="w-full bg-slate-100 text-slate-400 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide flex items-center justify-center gap-2 cursor-not-allowed">
                          <Lock size={12} /> Apenas Leitura
                        </div>
                      )
                    ) : (
                      <button disabled={!canEditProject} onClick={openNewTask} className={`w-8 h-8 rounded-lg shadow-sm flex items-center justify-center transition-all ${canEditProject ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-slate-100 text-slate-400'}`} title={canEditProject ? "Novo Projeto" : "Apenas Leitura"}>
                        {canEditProject ? <Plus size={16} /> : <Lock size={14} />}
                      </button>
                    )}
                  </div>
                  {monthsHeader.map((m, i) => <div key={i} className="flex-shrink-0 border-r border-slate-100 py-2 px-3 text-[11px] font-bold text-slate-400 uppercase tracking-tight" style={{ width: m.days * DAY_WIDTH }}>{m.label}</div>)}
                </div>
                <div className="flex border-b border-slate-100">
                  <div className={`${isSidebarOpen ? 'w-64' : 'w-12'} flex-shrink-0 p-3 bg-white border-r border-slate-100 sticky left-0 z-40 flex items-center justify-between`}>
                    {isSidebarOpen && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Projetos</span>
                      </div>
                    )}
                    <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-1 hover:bg-slate-50 rounded text-slate-400">{isSidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}</button>
                  </div>
                  {diasGantt.map((d, i) => {
                    const isToday = d.toDateString() === new Date().toDateString();
                    const isWknd = d.getDay() === 0 || d.getDay() === 6;
                    return <div key={i} style={{ width: DAY_WIDTH }} className={`flex-shrink-0 border-r border-slate-100 flex flex-col items-center py-2 text-[10px] ${isToday ? 'bg-indigo-50 text-indigo-600 font-bold' : isWknd ? 'bg-slate-50 text-slate-400 font-medium' : 'text-slate-500 font-medium'}`}>
                      <span>{d.getDate()}</span>
                      <span className="opacity-60 uppercase">{d.toLocaleDateString('pt-BR', { weekday: 'short' }).slice(0, 1)}</span>
                    </div>
                  })}
                </div>
              </div>

              <div className="relative">
                <svg className="absolute top-0 left-0 w-full h-full pointer-events-none z-10">
                  <defs>
                    <marker id="arrowhead" markerWidth="5" markerHeight="5" refX="5" refY="2.5" orient="auto">
                      <path d="M0,0 L0,5 L5,2.5 z" fill="#94a3b8" />
                    </marker>
                  </defs>
                  {filteredTarefas.map((t, i) => (
                    t.dependencias?.map(depId => {
                      const depIdx = filteredTarefas.findIndex(x => x.id === depId);
                      if (depIdx < 0) return null;
                      const depT = filteredTarefas[depIdx];

                      const startGeo = getBarGeo(depT.inicio, depT.fim);
                      const endGeo = getBarGeo(t.inicio, t.fim);
                      const sbW = isSidebarOpen ? 256 : 48;
                      const isBelow = i > depIdx;

                      let x1, y1;
                      if (isBelow) {
                        const offset = Math.min(20, startGeo.w / 2);
                        x1 = startGeo.x + startGeo.w + sbW - offset;
                        y1 = (depIdx * ROW_HEIGHT) + 52;
                      } else {
                        x1 = startGeo.x + startGeo.w + sbW;
                        y1 = (depIdx * ROW_HEIGHT) + (ROW_HEIGHT / 2);
                      }

                      const x2 = endGeo.x + sbW;
                      const y2 = i * ROW_HEIGHT + (ROW_HEIGHT / 2);

                      let path = '';
                      const r = 6;

                      if (isBelow) {
                        const sx = x2 > x1 ? 1 : -1;
                        if (Math.abs(x2 - x1) < r) {
                          path = `M ${x1} ${y1} L ${x1} ${y2} L ${x2} ${y2}`;
                        } else {
                          path = `M ${x1} ${y1} L ${x1} ${y2 - r} Q ${x1} ${y2} ${x1 + (r * sx)} ${y2} L ${x2} ${y2}`;
                        }
                      } else {
                        const gap = 15;
                        const isBelowTarget = y2 > y1;
                        const isRight = x2 > x1 + gap + r;

                        if (isRight) {
                          const turnX = x1 + gap;
                          const sy = isBelowTarget ? 1 : -1;
                          path = `M ${x1} ${y1} L ${turnX - r} ${y1} Q ${turnX} ${y1} ${turnX} ${y1 + (r * sy)} L ${turnX} ${y2 - (r * sy)} Q ${turnX} ${y2} ${turnX + r} ${y2} L ${x2} ${y2}`;
                        } else {
                          const turnX = x1 + gap;
                          const sy = isBelowTarget ? 1 : -1;
                          path = `M ${x1} ${y1} L ${turnX - r} ${y1} Q ${turnX} ${y1} ${turnX} ${y1 + (r * sy)} L ${turnX} ${y2 - (r * sy)} Q ${turnX} ${y2} ${Math.max(x2, turnX - r)} ${y2} L ${x2} ${y2}`;
                        }
                      }

                      return <path key={`${t.id}-${depId}`} d={path} stroke="#cbd5e1" strokeWidth="1.5" fill="none" markerEnd="url(#arrowhead)" shapeRendering="geometricPrecision" />;
                    })
                  ))}
                </svg>

                {todayPos !== null && (
                  <div className="absolute top-0 bottom-0 w-px bg-red-500 z-40 pointer-events-none" style={{ left: todayPos + (isSidebarOpen ? 256 : 48) }}>
                    <div className="w-1.5 h-1.5 bg-red-500 rounded-full -ml-[2.5px]"></div>
                  </div>
                )}

                {filteredTarefas.map((t) => {
                  const geo = getBarGeo(t.inicio, t.fim);
                  const status = getStatusConfig(t.status);
                  const isPushed = t.isDelayedByDeps;

                  const resps = t.responsaveis && t.responsaveis.length > 0
                    ? t.responsaveis
                    : t.responsavel ? [t.responsavel] : [];

                  let barColorClass = 'bg-slate-600';
                  if (t.status === 'em_andamento') barColorClass = 'bg-blue-500';
                  if (t.status === 'concluido') barColorClass = 'bg-emerald-500';

                  const isMenuOpen = activeRespSelector === t.id && canEditProject;

                  return (
                    <div key={t.id} className="flex border-b border-slate-50 hover:bg-slate-50 transition-colors" style={{ height: ROW_HEIGHT }}>
                      <div className={`${isSidebarOpen ? 'w-64' : 'w-12'} flex-shrink-0 border-r border-slate-100 sticky left-0 ${isMenuOpen ? 'z-[60]' : 'z-20'} bg-white/95 backdrop-blur-sm px-3 py-2 flex items-center gap-3 overflow-visible`}>
                        <button onClick={() => toggleConcluido(t.id)} className={t.concluido ? 'text-emerald-500' : 'text-slate-300 hover:text-slate-500'}>{t.concluido ? <CheckSquare size={18} /> : <Square size={18} />}</button>
                        {isSidebarOpen && (
                          <div className="min-w-0 flex-1 group">
                            <div title={t.titulo} className={`text-sm font-medium truncate mb-1 ${t.concluido ? 'line-through text-slate-400' : 'text-slate-700'}`}>{t.titulo}</div>
                            <div className="flex items-center justify-between mt-1 relative">
                              <div className="flex items-center gap-2 min-w-0 flex-1">

                                <div
                                  className={`flex flex-col min-w-0 flex-1 ${canEditProject ? 'cursor-pointer hover:opacity-70' : 'cursor-default opacity-80'} transition-opacity mr-2`}
                                  title={canEditProject ? "Clique para gerenciar responsáveis" : "Responsáveis (Somente Leitura)"}
                                  onClick={(e) => {
                                    if (!canEditProject) return;
                                    e.stopPropagation();
                                    setActiveRespSelector(activeRespSelector === t.id ? null : t.id);
                                  }}
                                >
                                  {resps.length > 0 ? (
                                    <div className="flex flex-col gap-0.5">
                                      {resps.slice(0, 2).map((r, i) => (
                                        <div key={i} className="flex items-center gap-1.5 min-w-0">
                                          <UserIcon size={10} className="text-slate-400 flex-shrink-0" />
                                          <span className="text-[10px] text-slate-600 font-medium truncate">{r}</span>
                                        </div>
                                      ))}
                                      {resps.length > 2 && (
                                        <span className="text-[9px] text-slate-400 pl-4 leading-none">+{resps.length - 2}</span>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5 text-slate-400">
                                      {canEditProject ? <PlusCircle size={12} /> : <UserIcon size={12} />}
                                      <span className="text-[10px]">{canEditProject ? 'Atribuir' : '-'}</span>
                                    </div>
                                  )}
                                </div>

                                {activeRespSelector === t.id && (
                                  <div ref={respSelectorRef} className="absolute top-full left-0 mt-1 bg-white border border-slate-200 shadow-xl rounded-lg z-50 w-48 p-2 animate-in fade-in zoom-in-95 duration-100">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-2 px-1">Responsáveis</div>
                                    <div className="max-h-32 overflow-y-auto space-y-1 mb-2">
                                      {uniqueResponsibles.map(name => {
                                        const isSelected = resps.includes(name);
                                        return (
                                          <div
                                            key={name}
                                            className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs cursor-pointer ${isSelected ? 'bg-indigo-50 text-indigo-700 font-medium' : 'hover:bg-slate-50 text-slate-600'}`}
                                            onClick={() => {
                                              const newResps = isSelected
                                                ? resps.filter(r => r !== name)
                                                : [...resps, name];
                                              handleUpdateResponsibles(t.id, newResps);
                                            }}
                                          >
                                            <div className={`w-3 h-3 rounded border flex items-center justify-center ${isSelected ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-300'}`}>
                                              {isSelected && <Check size={8} className="text-white" />}
                                            </div>
                                            <span className="truncate">{name}</span>
                                          </div>
                                        )
                                      })}
                                      {uniqueResponsibles.length === 0 && <div className="px-2 text-xs text-slate-400">Nenhum salvo.</div>}
                                    </div>
                                    <div className="border-t border-slate-100 pt-2 flex gap-1">
                                      <input
                                        className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 outline-none focus:border-indigo-400"
                                        placeholder="Novo..."
                                        value={newRespInputValue}
                                        onChange={e => setNewRespInputValue(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' && newRespInputValue.trim()) {
                                            const name = newRespInputValue.trim();
                                            if (!resps.includes(name)) {
                                              handleUpdateResponsibles(t.id, [...resps, name]);
                                            }
                                            setNewRespInputValue('');
                                          }
                                        }}
                                      />
                                      <button
                                        className="bg-indigo-600 text-white rounded p-1 hover:bg-indigo-700"
                                        onClick={() => {
                                          if (newRespInputValue.trim()) {
                                            const name = newRespInputValue.trim();
                                            if (!resps.includes(name)) {
                                              handleUpdateResponsibles(t.id, [...resps, name]);
                                            }
                                            setNewRespInputValue('');
                                          }
                                        }}
                                      >
                                        <Plus size={12} />
                                      </button>
                                    </div>
                                  </div>
                                )}

                                <div className="relative group/status flex-shrink-0">
                                  <select
                                    value={t.status}
                                    onChange={(e) => handleChangeStatus(t.id, e.target.value)}
                                    className="appearance-none absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                  >
                                    {statusList.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                                  </select>
                                  <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md border transition-colors cursor-pointer ${status.colorClass}`}>
                                    <div className={`w-1.5 h-1.5 rounded-full ${status.colorClass.split(' ')[0].replace('bg-', 'bg-current ')} opacity-50`}></div>
                                    <span className="text-[10px] font-semibold tracking-wide uppercase">{status.label}</span>
                                  </div>
                                </div>
                              </div>
                              {canEditProject && (
                                <button onClick={() => handleDeleteRequest('task', t.id)} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-opacity p-1"><Trash2 size={14} /></button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 relative">
                        <div
                          onClick={() => openEditTask(t)}
                          className={`absolute top-4 h-8 cursor-pointer flex items-center px-2 text-[11px] text-white font-medium whitespace-nowrap overflow-hidden transition-all rounded-md shadow-sm hover:shadow-md hover:-translate-y-0.5 ${barColorClass} ${t.concluido ? 'opacity-50 grayscale hover:shadow-sm hover:translate-y-0' : ''} ${isPushed ? 'ring-2 ring-orange-300 ring-offset-1' : ''}`}
                          style={{ left: geo.x, width: geo.w }}
                          title={t.titulo}
                        >
                          {t.constraintDate && <Pin size={10} className="mr-1 fill-white/20" />}
                          <span className="truncate flex-1">{t.titulo}</span>
                          {isPushed && <ArrowRight size={10} className="text-white/90 ml-1" />}
                          {!canEditProject && <Eye size={10} className="ml-2 opacity-50" />}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* MODAL DE EDIÇÃO */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200 relative flex flex-col max-h-[90vh] border border-slate-100">

            <div className={`px-6 py-4 border-b border-slate-100 flex justify-between items-center ${canEditProject ? 'bg-white' : 'bg-slate-50'}`}>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-lg text-slate-800">{editingTask ? 'Detalhes do Projeto' : 'Novo Projeto'}</h2>
                {!canEditProject && <span className="bg-orange-100 text-orange-700 text-[10px] uppercase font-bold px-2 py-0.5 rounded">Apenas Leitura</span>}
              </div>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-50 transition-colors"><X size={20} /></button>
            </div>

            <form onSubmit={handleSaveTask} className="flex-1 overflow-y-auto custom-scrollbar">
              <div className="p-6 space-y-6">

                <div className="grid grid-cols-12 gap-4">
                  <div className="col-span-8">
                    <label className="text-xs font-semibold text-slate-500 uppercase mb-1.5 block tracking-wide">Título</label>
                    <input name="titulo" disabled={!canEditProject} required defaultValue={editingTask?.titulo} placeholder="Nome do projeto..." className={`w-full border p-2.5 rounded-lg outline-none text-sm text-slate-700 font-medium transition-all ${canEditProject ? 'bg-white border-slate-200 focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400' : 'bg-slate-50 border-slate-200 text-slate-500'}`} />
                  </div>
                  <div className="col-span-4 relative" ref={respDropdownRef}>
                    <label className="text-xs font-semibold text-slate-500 uppercase mb-1.5 block tracking-wide">Responsáveis</label>

                    <div
                      className={`w-full border p-2.5 rounded-lg flex items-center justify-between transition-all min-h-[42px] ${canEditProject ? 'bg-white cursor-pointer hover:border-slate-300' : 'bg-slate-50 cursor-default border-slate-200'}`}
                      onClick={() => canEditProject && setIsRespDropdownOpen(!isRespDropdownOpen)}
                    >
                      <div className="flex flex-wrap gap-1.5 flex-1 items-center">
                        {formResponsaveis.length > 0 ? (
                          formResponsaveis.map(r => (
                            <span key={r} className="bg-indigo-50 text-indigo-700 text-[10px] font-bold px-1.5 py-0.5 rounded border border-indigo-100 flex items-center gap-1">
                              {r}
                              {canEditProject && <div onClick={(e) => {
                                e.stopPropagation();
                                setFormResponsaveis(formResponsaveis.filter(x => x !== r));
                              }} className="hover:text-indigo-900 cursor-pointer p-0.5 rounded-full hover:bg-indigo-100 transition-colors">
                                <X size={8} />
                              </div>}
                            </span>
                          ))
                        ) : (
                          <span className="text-slate-400 text-sm">Selecionar...</span>
                        )}
                      </div>
                      {canEditProject && <ChevronDown size={16} className={`text-slate-400 transition-transform duration-200 flex-shrink-0 ml-2 ${isRespDropdownOpen ? 'rotate-180' : ''}`} />}
                    </div>

                    {isRespDropdownOpen && canEditProject && (
                      <div className="absolute top-full right-0 mt-1 w-full bg-white border border-slate-200 shadow-xl rounded-lg z-50 p-2 animate-in fade-in zoom-in-95 duration-100">
                        <div className="max-h-48 overflow-y-auto space-y-0.5 custom-scrollbar mb-2">
                          {Array.from(new Set([...uniqueResponsibles, ...formResponsaveis])).sort().map(name => {
                            const isSelected = formResponsaveis.includes(name);
                            return (
                              <div
                                key={name}
                                className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${isSelected ? 'bg-indigo-50 text-indigo-700 font-medium' : 'hover:bg-slate-50 text-slate-600'}`}
                                onClick={() => {
                                  const newResps = isSelected
                                    ? formResponsaveis.filter(r => r !== name)
                                    : [...formResponsaveis, name];
                                  setFormResponsaveis(newResps);
                                }}
                              >
                                <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all flex-shrink-0 ${isSelected ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-300'}`}>
                                  {isSelected && <Check size={8} className="text-white" />}
                                </div>
                                <span className="truncate">{name}</span>
                              </div>
                            );
                          })}
                          {uniqueResponsibles.length === 0 && formResponsaveis.length === 0 && (
                            <div className="px-2 py-2 text-center text-xs text-slate-400">Nenhum salvo.</div>
                          )}
                        </div>

                        <div className="border-t border-slate-100 pt-2 flex gap-1">
                          <input
                            id="new-resp-input-modal"
                            className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 outline-none focus:border-indigo-400 bg-white placeholder:text-slate-400"
                            placeholder="Novo..."
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                const val = e.currentTarget.value.trim();
                                if (val && !formResponsaveis.includes(val)) {
                                  setFormResponsaveis([...formResponsaveis, val]);
                                  e.currentTarget.value = '';
                                }
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <button
                            type="button"
                            className="bg-indigo-600 text-white rounded p-1 hover:bg-indigo-700 transition-colors flex items-center justify-center w-6 flex-shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              const input = document.getElementById('new-resp-input-modal') as HTMLInputElement;
                              if (input && input.value.trim()) {
                                const val = input.value.trim();
                                if (!formResponsaveis.includes(val)) {
                                  setFormResponsaveis([...formResponsaveis, val]);
                                  input.value = '';
                                }
                              }
                            }}
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-12 gap-4">
                  <div className="col-span-4">
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Início</label>
                      {formDeps.length > 0 && canEditProject && (
                        <div className="flex items-center gap-2 cursor-pointer group" onClick={() => setIsConstraintActive(!isConstraintActive)}>
                          <span className="text-[10px] font-medium text-slate-400 group-hover:text-slate-600 transition-colors">Fixar</span>
                          <div className={`w-6 h-3 rounded-full p-0.5 flex items-center transition-colors ${isConstraintActive ? 'bg-indigo-600' : 'bg-slate-200'}`}>
                            <div className={`w-2 h-2 bg-white rounded-full shadow-sm transform transition-transform ${isConstraintActive ? 'translate-x-3' : 'translate-x-0'}`} />
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type="date"
                        value={formStart}
                        onChange={e => handleStartDateChange(e.target.value)}
                        disabled={!canEditProject || (!isConstraintActive && formDeps.length > 0)}
                        className={`w-full border p-2.5 rounded-lg outline-none text-sm font-medium transition-all
                                    ${(!canEditProject || (!isConstraintActive && formDeps.length > 0))
                            ? 'bg-slate-50 text-slate-400 border-slate-200'
                            : 'bg-white border-slate-200 text-slate-700 focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400'
                          }`}
                      />
                      {(!isConstraintActive && formDeps.length > 0) && (
                        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-slate-400 bg-slate-50/80 pointer-events-none rounded-lg">Automático</span>
                      )}
                    </div>
                  </div>

                  <div className="col-span-4">
                    <label className="text-xs font-semibold text-slate-500 uppercase mb-1.5 block tracking-wide">Fim</label>
                    <input
                      type="date"
                      value={formEnd}
                      disabled={!canEditProject}
                      onChange={e => handleEndDateChange(e.target.value)}
                      min={formStart}
                      className={`w-full border p-2.5 rounded-lg outline-none text-sm font-medium transition-all ${canEditProject ? 'bg-white border-slate-200 text-slate-700' : 'bg-slate-50 border-slate-200 text-slate-400'}`}
                    />
                  </div>

                  <div className="col-span-4">
                    <label className="text-xs font-semibold text-slate-500 uppercase mb-1.5 block tracking-wide">Duração</label>
                    <div className="flex items-center">
                      <input
                        type="number"
                        min="1"
                        disabled={!canEditProject}
                        value={formDuration}
                        onChange={e => handleDurationChange(parseInt(e.target.value) || 1)}
                        className={`w-full border border-slate-200 p-2.5 rounded-l-lg outline-none text-sm font-medium ${canEditProject ? 'bg-white text-slate-700' : 'bg-slate-50 text-slate-400'}`}
                      />
                      <div className="bg-slate-50 border border-l-0 border-slate-200 px-3 py-2.5 rounded-r-lg text-sm font-medium text-slate-500">Dias</div>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block tracking-wide">Dias Úteis</label>
                  <div className="flex gap-1">
                    {WEEK_DAYS_CONFIG.map(d => {
                      const isSelected = formDiasUteis.includes(d.id);
                      return (
                        <button
                          key={d.id}
                          type="button"
                          disabled={!canEditProject}
                          onClick={() => handleWorkingDaysChange(d.id)}
                          className={`flex-1 py-2 text-[10px] font-bold uppercase rounded-md transition-all border ${isSelected ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-slate-400 border-slate-200'} ${!canEditProject ? 'opacity-70 cursor-not-allowed' : 'hover:border-slate-300'}`}
                        >
                          {d.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block tracking-wide">Dependências</label>
                  <div className={`border border-slate-200 rounded-lg max-h-40 overflow-y-auto p-1 ${canEditProject ? 'bg-slate-50' : 'bg-slate-100 opacity-70'}`}>
                    {tarefas.filter(t => t.id !== (editingTask?.id ?? 'new')).map(t => {
                      const isChecked = formDeps.includes(t.id);
                      return (
                        <label key={t.id} className={`flex items-center gap-3 p-2 border-b border-slate-100 last:border-0 rounded-md transition-colors ${canEditProject ? 'cursor-pointer hover:bg-white' : 'cursor-default'} ${isChecked ? 'bg-white shadow-sm' : ''}`}>
                          <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all flex-shrink-0 ${isChecked ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-300'}`}>
                            {isChecked && <Check size={12} className="text-white" />}
                            <input
                              type="checkbox"
                              disabled={!canEditProject}
                              name="dependencias"
                              value={t.id}
                              checked={isChecked}
                              onChange={() => handleDependencyClick(t)}
                              className="hidden"
                            />
                          </div>
                          <span className={`text-sm ${isChecked ? 'font-medium text-indigo-700' : 'text-slate-600 font-medium'}`}>{t.titulo}</span>
                        </label>
                      )
                    })}
                    {tarefas.filter(t => t.id !== (editingTask?.id ?? 'new')).length === 0 && (
                      <div className="p-4 text-center text-xs font-medium text-slate-400">Sem outros projetos para vincular.</div>
                    )}
                  </div>
                </div>

              </div>

              <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between sticky bottom-0 z-10 rounded-b-xl">
                <div className="flex bg-white p-1 rounded-lg border border-slate-200 shadow-sm">
                  {statusList.map(s => (
                    <label key={s.id} className="cursor-pointer">
                      <input type="radio" name="status" value={s.id} checked={formStatus === s.id} onChange={() => setFormStatus(s.id)} className="peer sr-only" />
                      <div className={`px-3 py-1.5 rounded-md text-xs font-bold uppercase transition-all ${formStatus === s.id ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                        {s.label}
                      </div>
                    </label>
                  ))}
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg text-sm transition-colors">Cancelar</button>
                  <button type="submit" className="px-5 py-2 bg-indigo-600 text-white rounded-lg shadow-sm font-medium text-sm transition-all hover:bg-indigo-700 hover:shadow-md">
                    {canEditProject ? 'Salvar' : 'Atualizar Status'}
                  </button>
                </div>
              </div>

            </form>
          </div>
        </div>
      )}

      {isSettingsModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-4 bg-white border-b border-slate-100 flex justify-between items-center"><h2 className="font-bold text-slate-800">Configurações</h2><button onClick={() => setIsSettingsModalOpen(false)}><X size={20} className="text-slate-400 hover:text-slate-600 transition-colors" /></button></div>
            <div className="p-6 text-center space-y-4">
              <p className="text-sm font-medium text-slate-600">Backup e dados do sistema.</p>
              <button onClick={() => {
                const data = { tasks: tarefas, settings: { statuses: statusList } };
                const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = 'backup.json'; a.click();
              }} className="w-full bg-slate-800 hover:bg-slate-900 text-white py-2.5 rounded-lg font-medium flex items-center justify-center gap-2 text-sm shadow-sm transition-all"><Download size={18} /> Exportar JSON</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE EQUIPE ATUALIZADO */}
      {isTeamModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div className="p-4 bg-white border-b border-slate-100 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Users className="text-indigo-600" size={20} />
                <h2 className="font-bold text-slate-800">Acesso da Equipe</h2>
              </div>
              <button onClick={() => setIsTeamModalOpen(false)}><X size={20} className="text-slate-400 hover:text-slate-600 transition-colors" /></button>
            </div>

            <div className="p-6 overflow-y-auto">
              {/* SEÇÃO 1: SOU ADMINISTRADOR (Adicionar Emails) */}
              {viewMode === 'admin' ? (
                <div className="space-y-6">

                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <UserPlus size={16} className="text-indigo-600" />
                      <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Convidar Membros</h3>
                    </div>
                    <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                      Basta adicionar o email. O membro verá o convite ao logar.
                    </p>
                    <div className="flex gap-2 mb-4">
                      <input
                        type="email"
                        placeholder="email@exemplo.com"
                        value={newEmailInput}
                        onChange={e => setNewEmailInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAddAllowedEmail()}
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 transition-all"
                      />
                      <button
                        onClick={handleAddAllowedEmail}
                        disabled={!newEmailInput.includes('@')}
                        className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 rounded-lg flex items-center justify-center transition-colors"
                      >
                        <Plus size={18} />
                      </button>
                    </div>

                    <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar border border-slate-100 rounded-lg p-1">
                      {allowedEmails.length > 0 ? (
                        allowedEmails.map(email => (
                          <div key={email} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-100 group">
                            <div className="flex items-center gap-2 overflow-hidden">
                              <div className="w-6 h-6 rounded-full bg-white border border-slate-200 flex items-center justify-center text-[10px] font-bold text-indigo-600 uppercase flex-shrink-0">
                                {email[0]}
                              </div>
                              <span className="text-xs font-medium text-slate-600 truncate">{email}</span>
                            </div>
                            <button onClick={() => handleRemoveAllowedEmail(email)} className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                              <X size={14} />
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-6 text-xs text-slate-400 italic">
                          Nenhum membro autorizado. <br /> Adicione emails acima.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="relative pt-2">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div>
                    <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-slate-400 font-medium">Ou</span></div>
                  </div>

                  {/* Seção de Convites Recebidos (Mostrar apenas se houver convites) */}
                  {myInvites.length > 0 && (
                    <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Mail size={16} className="text-indigo-600" />
                        <h3 className="text-sm font-bold text-indigo-800 uppercase tracking-wide">Convites Recebidos</h3>
                      </div>
                      <div className="space-y-2">
                        {myInvites.map((invite) => (
                          <div key={invite.adminId} className="bg-white p-3 rounded-lg border border-indigo-100 shadow-sm flex items-center justify-between">
                            <div>
                              <div className="text-xs text-slate-500 font-medium mb-0.5">Equipe de</div>
                              <div className="text-sm font-bold text-indigo-700">{invite.adminName}</div>
                            </div>
                            <button
                              onClick={() => handleJoinTeam(invite.adminId, invite.adminName)}
                              className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wide flex items-center gap-1 transition-colors"
                            >
                              Entrar <LogIn size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Entrada Manual (Fallback) */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Users size={16} className="text-orange-600" />
                      <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Entrar com Código (Manual)</h3>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Cole o ID da equipe..."
                        value={teamCodeInput}
                        onChange={(e) => setTeamCodeInput(e.target.value)}
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400 transition-all"
                      />
                      <button
                        onClick={() => handleJoinTeam(teamCodeInput)}
                        className="bg-orange-600 hover:bg-orange-700 text-white px-4 rounded-lg text-sm font-medium transition-colors shadow-sm"
                      >
                        Entrar
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                // SEÇÃO 2: JÁ SOU MEMBRO (Status da Conexão)
                <div className="bg-orange-50 border border-orange-100 rounded-xl p-6 text-center">
                  <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-3 text-orange-600">
                    <Users size={24} />
                  </div>
                  <p className="text-sm font-bold text-orange-800 mb-1">Você está conectado à equipe!</p>
                  <p className="text-xs text-orange-600/80 mb-6 font-mono break-all">{connectedTeamId}</p>

                  <div className="bg-white p-3 rounded-lg border border-orange-100 text-left mb-6">
                    <div className="flex items-center gap-2 mb-1">
                      <Mail size={12} className="text-orange-400" />
                      <span className="text-xs font-bold text-orange-800 uppercase">Sua conta de acesso</span>
                    </div>
                    <div className="text-xs text-slate-600 font-medium truncate">{user?.email || 'Anônimo'}</div>
                  </div>

                  <button
                    onClick={handleLeaveTeam}
                    className="w-full bg-white border border-orange-200 text-orange-700 hover:bg-orange-100 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                  >
                    <LogOut size={16} /> Sair desta Equipe
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { height: 8px; width: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
      `}</style>
    </div>
  );
}
