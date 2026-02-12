import React, { useState, useEffect } from 'react';
import {
    X,
    Check,
    ChevronDown,
    Plus
} from 'lucide-react';
import type { Tarefa, StatusConfig } from '../../types';
import { WEEK_DAYS_CONFIG, DEFAULT_WORKING_DAYS } from '../../config/constants';
import {
    parseDate,
    formatDate,
    calendarAdd,
    calculateDuration
} from '../../utils/dateUtils';
import { runSchedulingEngine } from '../../utils/scheduling';
import { doc, writeBatch } from 'firebase/firestore';
import { db, appId } from '../../config/firebase';
import type { User } from 'firebase/auth';

interface TaskFormProps {
    user: User | null;
    tasks: Tarefa[];
    statusList: StatusConfig[];
    editingTask: Tarefa | null;
    onClose: () => void;
    onSave: () => void;
    showNotification: (msg: string, type: 'error' | 'success' | 'warning' | 'info') => void;
}

export const TaskForm: React.FC<TaskFormProps> = ({
    user,
    tasks,
    statusList,
    editingTask,
    onClose,
    onSave,
    showNotification
}) => {
    const [formStart, setFormStart] = useState('');
    const [formDuration, setFormDuration] = useState(1);
    const [formEnd, setFormEnd] = useState('');
    const [formDiasUteis, setFormDiasUteis] = useState<number[]>(DEFAULT_WORKING_DAYS);
    const [formStatus, setFormStatus] = useState('pendente');
    const [formDeps, setFormDeps] = useState<string[]>([]);
    const [formResponsaveis, setFormResponsaveis] = useState<string[]>([]);
    const [isConstraintActive, setIsConstraintActive] = useState(false);
    const [isRespDropdownOpen, setIsRespDropdownOpen] = useState(false);

    useEffect(() => {
        if (editingTask) {
            setFormStart(editingTask.constraintDate || editingTask.inicio);
            setFormDuration(editingTask.duracaoEstimada || 1);
            setFormEnd(editingTask.fim);
            setFormDiasUteis(editingTask.diasUteis || DEFAULT_WORKING_DAYS);
            setFormStatus(editingTask.status);
            setFormDeps(editingTask.dependencias || []);
            const currentResps = editingTask.responsaveis || (editingTask.responsavel ? [editingTask.responsavel] : []);
            setFormResponsaveis(currentResps);
            setIsConstraintActive(!!editingTask.constraintDate || (!editingTask.dependencias || editingTask.dependencias.length === 0));
        } else {
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
        }
    }, [editingTask]);

    const uniqueResponsibles = React.useMemo(() => {
        const names = new Set<string>();
        tasks.forEach(t => {
            if (t.responsaveis && Array.isArray(t.responsaveis)) {
                t.responsaveis.forEach(r => names.add(r));
            } else if (t.responsavel) {
                names.add(t.responsavel);
            }
        });
        return Array.from(names).sort();
    }, [tasks]);

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

    const handleDependencyClick = (task: Tarefa) => {
        if (formDeps.includes(task.id)) {
            setFormDeps(formDeps.filter(id => id !== task.id));
        } else {
            setFormDeps([...formDeps, task.id]);
        }
    };

    const handleSaveTask = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!user) return;

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

        const allTasks = [...tasks.filter(t => t.id !== taskId), baseTarefa];

        try {
            const recalculatedTasks = runSchedulingEngine(allTasks);
            const batch = writeBatch(db);
            recalculatedTasks.forEach((task) => {
                const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'tasks', task.id);
                const cleanTask = JSON.parse(JSON.stringify(task));
                batch.set(docRef, cleanTask);
            });

            await batch.commit();
            onSave();
            showNotification("Projeto salvo com sucesso!", 'success');
        } catch (e: any) {
            console.error(e);
            showNotification(e.message || "Erro no cálculo.", 'error');
        }
    };

    return (
        <form onSubmit={handleSaveTask} className="flex-1 overflow-y-auto custom-scrollbar">
            <div className="p-6 space-y-6">

                <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-8">
                        <label className="text-xs font-semibold text-slate-500 uppercase mb-1.5 block tracking-wide">Título</label>
                        <input name="titulo" required defaultValue={editingTask?.titulo} placeholder="Nome do projeto..." className="w-full border border-slate-200 bg-white p-2.5 rounded-lg outline-none text-sm text-slate-700 font-medium focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 transition-all placeholder:text-slate-400" />
                    </div>
                    <div className="col-span-4 relative">
                        <label className="text-xs font-semibold text-slate-500 uppercase mb-1.5 block tracking-wide">Responsáveis</label>

                        <div
                            className={`w-full border bg-white p-2.5 rounded-lg flex items-center justify-between cursor-pointer transition-all min-h-[42px] ${isRespDropdownOpen ? 'ring-2 ring-indigo-100 border-indigo-400' : 'border-slate-200 hover:border-slate-300'}`}
                            onClick={() => setIsRespDropdownOpen(!isRespDropdownOpen)}
                        >
                            <div className="flex flex-wrap gap-1.5 flex-1 items-center">
                                {formResponsaveis.length > 0 ? (
                                    formResponsaveis.map(r => (
                                        <span key={r} className="bg-indigo-50 text-indigo-700 text-[10px] font-bold px-1.5 py-0.5 rounded border border-indigo-100 flex items-center gap-1 animate-in zoom-in-50 duration-200">
                                            {r}
                                            <div onClick={(e) => {
                                                e.stopPropagation();
                                                setFormResponsaveis(formResponsaveis.filter(x => x !== r));
                                            }} className="hover:text-indigo-900 cursor-pointer p-0.5 rounded-full hover:bg-indigo-100 transition-colors">
                                                <X size={8} />
                                            </div>
                                        </span>
                                    ))
                                ) : (
                                    <span className="text-slate-400 text-sm">Selecionar...</span>
                                )}
                            </div>
                            <ChevronDown size={16} className={`text-slate-400 transition-transform duration-200 flex-shrink-0 ml-2 ${isRespDropdownOpen ? 'rotate-180' : ''}`} />
                        </div>

                        {isRespDropdownOpen && (
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
                            {formDeps.length > 0 && (
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
                                disabled={!isConstraintActive && formDeps.length > 0}
                                className={`w-full border p-2.5 rounded-lg outline-none text-sm font-medium transition-all
                            ${(!isConstraintActive && formDeps.length > 0)
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
                            onChange={e => handleEndDateChange(e.target.value)}
                            min={formStart}
                            className="w-full border border-slate-200 bg-white p-2.5 rounded-lg outline-none text-sm text-slate-700 font-medium focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 transition-all placeholder:text-slate-400"
                        />
                    </div>

                    <div className="col-span-4">
                        <label className="text-xs font-semibold text-slate-500 uppercase mb-1.5 block tracking-wide">Duração</label>
                        <div className="flex items-center">
                            <input
                                type="number"
                                min="1"
                                value={formDuration}
                                onChange={e => handleDurationChange(parseInt(e.target.value) || 1)}
                                className="w-full border border-slate-200 p-2.5 rounded-l-lg outline-none text-sm font-medium text-slate-700 focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 focus:z-10 transition-all"
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
                                    onClick={() => handleWorkingDaysChange(d.id)}
                                    className={`flex-1 py-2 text-[10px] font-bold uppercase rounded-md transition-all border ${isSelected ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300 hover:text-slate-600'}`}
                                >
                                    {d.label}
                                </button>
                            )
                        })}
                    </div>
                </div>

                <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block tracking-wide">Dependências</label>
                    <div className="border border-slate-200 rounded-lg max-h-40 overflow-y-auto p-1 bg-slate-50">
                        {tasks.filter(t => t.id !== (editingTask?.id ?? 'new')).map(t => {
                            const isChecked = formDeps.includes(t.id);
                            return (
                                <label key={t.id} className={`flex items-center gap-3 p-2 cursor-pointer border-b border-slate-100 last:border-0 rounded-md hover:bg-white transition-colors ${isChecked ? 'bg-white shadow-sm' : ''}`}>
                                    <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all flex-shrink-0 ${isChecked ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-300'}`}>
                                        {isChecked && <Check size={12} className="text-white" />}
                                        <input
                                            type="checkbox"
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
                        {tasks.filter(t => t.id !== (editingTask?.id ?? 'new')).length === 0 && (
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
                    <button type="button" onClick={onClose} className="px-4 py-2 font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg text-sm transition-colors">Cancelar</button>
                    <button type="submit" className="px-5 py-2 bg-indigo-600 text-white rounded-lg shadow-sm font-medium text-sm transition-all hover:bg-indigo-700 hover:shadow-md">
                        Salvar
                    </button>
                </div>
            </div>

        </form>
    );
};
