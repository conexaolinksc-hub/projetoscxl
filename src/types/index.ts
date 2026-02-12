export interface StatusConfig {
    id: string;
    label: string;
    colorClass: string;
    pinned?: boolean;
}

export type DiasUteis = number[];

export interface Tarefa {
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

export interface Notification {
    message: string;
    type: 'error' | 'success' | 'warning' | 'info';
}

export interface DeleteState {
    type: 'task' | 'status';
    id: string;
}
