import type { StatusConfig } from '../types';

export const ROW_HEIGHT = 64;
export const DAY_WIDTH = 50;

export const WEEK_DAYS_CONFIG = [
    { id: 0, label: 'Dom', longLabel: 'Domingo' },
    { id: 1, label: 'Seg', longLabel: 'Segunda' },
    { id: 2, label: 'Ter', longLabel: 'Terça' },
    { id: 3, label: 'Qua', longLabel: 'Quarta' },
    { id: 4, label: 'Qui', longLabel: 'Quinta' },
    { id: 5, label: 'Sex', longLabel: 'Sexta' },
    { id: 6, label: 'Sáb', longLabel: 'Sábado' },
];

export const DEFAULT_WORKING_DAYS = [0, 1, 2, 3, 4, 5, 6];

export const DEFAULT_STATUSES: StatusConfig[] = [
    { id: 'pendente', label: 'Pendente', colorClass: 'bg-slate-100 text-slate-600 border-slate-200', pinned: true },
    { id: 'em_andamento', label: 'Em Andamento', colorClass: 'bg-blue-50 text-blue-600 border-blue-200', pinned: true },
    { id: 'concluido', label: 'Concluído', colorClass: 'bg-emerald-50 text-emerald-600 border-emerald-200', pinned: false },
];
