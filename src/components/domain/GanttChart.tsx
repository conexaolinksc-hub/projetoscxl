import React, { useRef, useState, useLayoutEffect } from 'react';
import {
    Plus,
    Trash2,
    CheckSquare,
    Square,
    PanelLeftClose,
    PanelLeftOpen,
    ArrowRight,
    Pin,
    User as UserIcon,
    PlusCircle,
    Check
} from 'lucide-react';
import type { Tarefa, StatusConfig } from '../../types';
import { DAY_WIDTH, ROW_HEIGHT } from '../../config/constants';
import { parseDate, getDaysDiff } from '../../utils/dateUtils';
import { doc, updateDoc } from 'firebase/firestore';
import { db, appId } from '../../config/firebase';
import type { User } from 'firebase/auth';

interface GanttChartProps {
    user: User | null;
    tasks: Tarefa[];
    statusList: StatusConfig[];
    ganttStartDate: Date;
    setGanttStartDate: (date: Date) => void;
    onEditTask: (task: Tarefa) => void;
    onNewTask: () => void;
    onDeleteTask: (id: string) => void;
    onToggleStatus: (id: string, newStatus: string) => void;
    showNotification: (msg: string, type: 'error' | 'success' | 'warning' | 'info') => void;
}

export const GanttChart: React.FC<GanttChartProps> = ({
    user,
    tasks,
    statusList,
    ganttStartDate,
    onEditTask,
    onNewTask,
    onDeleteTask,
    onToggleStatus
}) => {
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [activeRespSelector, setActiveRespSelector] = useState<string | null>(null);
    const [newRespInputValue, setNewRespInputValue] = useState('');
    const [isDragging, setIsDragging] = useState(false);
    const [startX, setStartX] = useState(0);
    const [scrollLeft, setScrollLeft] = useState(0);

    const ganttContainerRef = useRef<HTMLDivElement>(null);
    const hasInitialScrolled = useRef(false);
    const respSelectorRef = useRef<HTMLDivElement>(null);

    // Click outside handler for dropdowns
    React.useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (respSelectorRef.current && !respSelectorRef.current.contains(event.target as Node)) {
                setActiveRespSelector(null);
                setNewRespInputValue('');
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

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

    const handleUpdateResponsibles = async (taskId: string, newResps: string[]) => {
        if (!user) return;
        const taskRef = doc(db, 'artifacts', appId, 'users', user.uid, 'tasks', taskId);
        await updateDoc(taskRef, { responsaveis: newResps, responsavel: newResps[0] || '' });
    };

    const toggleConcluido = async (id: string) => {
        const task = tasks.find(t => t.id === id);
        if (task) {
            onToggleStatus(id, task.status === 'concluido' ? 'pendente' : 'concluido');
        }
    };

    const getStatusConfig = (id: string) => statusList.find(s => s.id === id) || statusList[0];

    const diasGantt = React.useMemo(() => {
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

    const monthsHeader = React.useMemo(() => {
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

    const todayPos = React.useMemo(() => {
        const now = new Date();
        const idx = diasGantt.findIndex(d => d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear());
        if (idx === -1) return null;
        const hourPct = (now.getHours() * 60 + now.getMinutes()) / 1440;
        return (idx * DAY_WIDTH) + (hourPct * DAY_WIDTH);
    }, [diasGantt]);

    useLayoutEffect(() => {
        if (!ganttContainerRef.current || !diasGantt.length) return;
        if (!hasInitialScrolled.current && todayPos !== null) {
            ganttContainerRef.current.scrollLeft = Math.max(0, todayPos - 50);
            hasInitialScrolled.current = true;
        }
    }, [todayPos, diasGantt]);

    // Helper for render
    const getGeo = (s: string, f: string) => {
        if (!diasGantt.length) return { x: 0, w: 0 };
        // Redefining here since utils version needs ganttStartDate context that is local to this view mostly or passed down.
        // Actually I can use the local diasGantt[0] as anchor.
        const startIdx = getDaysDiff(diasGantt[0], parseDate(s));
        const dur = getDaysDiff(parseDate(s), parseDate(f)) + 1;
        return { x: startIdx * DAY_WIDTH, w: dur * DAY_WIDTH };
    };

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col flex-1 overflow-hidden h-full">
            <div ref={ganttContainerRef} className="flex-1 overflow-auto relative custom-scrollbar select-none rounded-b-xl"
                onMouseDown={e => { setIsDragging(true); setStartX(e.pageX - ganttContainerRef.current!.offsetLeft); setScrollLeft(ganttContainerRef.current!.scrollLeft); }}
                onMouseMove={e => { if (!isDragging) return; e.preventDefault(); const x = e.pageX - ganttContainerRef.current!.offsetLeft; ganttContainerRef.current!.scrollLeft = scrollLeft - (x - startX); }}
                onMouseUp={() => setIsDragging(false)} onMouseLeave={() => setIsDragging(false)}>
                <div className="min-w-max">
                    <div className="flex flex-col sticky top-0 z-30 bg-white">
                        <div className="flex bg-white border-b border-slate-100">
                            <div className={`${isSidebarOpen ? 'w-64' : 'w-12'} flex-shrink-0 border-r border-slate-100 sticky left-0 z-40 bg-white flex items-center justify-center p-2 transition-all`}>
                                {isSidebarOpen ? (
                                    <button onClick={onNewTask} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-1.5 rounded-lg shadow-sm text-xs font-bold uppercase tracking-wide flex items-center justify-center gap-2 transition-all">
                                        <Plus size={14} /> Novo Projeto
                                    </button>
                                ) : (
                                    <button onClick={onNewTask} className="w-8 h-8 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm flex items-center justify-center transition-all" title="Novo Projeto">
                                        <Plus size={16} />
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
                            {tasks.map((t, i) => (
                                t.dependencias?.map(depId => {
                                    const depIdx = tasks.findIndex(x => x.id === depId);
                                    if (depIdx < 0) return null;
                                    const depT = tasks[depIdx];

                                    const startGeo = getGeo(depT.inicio, depT.fim);
                                    const endGeo = getGeo(t.inicio, t.fim);
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

                        {tasks.map((t) => {
                            const geo = getGeo(t.inicio, t.fim);
                            const status = getStatusConfig(t.status);
                            const isPushed = t.isDelayedByDeps;

                            const resps = t.responsaveis && t.responsaveis.length > 0
                                ? t.responsaveis
                                : t.responsavel ? [t.responsavel] : [];

                            let barColorClass = 'bg-slate-600';
                            if (t.status === 'em_andamento') barColorClass = 'bg-blue-500';
                            if (t.status === 'concluido') barColorClass = 'bg-emerald-500';

                            const isMenuOpen = activeRespSelector === t.id;

                            return (
                                <div key={t.id} className="flex border-b border-slate-50 hover:bg-slate-50 transition-colors" style={{ height: ROW_HEIGHT }}>
                                    <div className={`${isSidebarOpen ? 'w-64' : 'w-12'} flex-shrink-0 border-r border-slate-100 sticky left-0 ${isMenuOpen ? 'z-[60]' : 'z-20'} bg-white/95 backdrop-blur-sm px-3 py-2 flex items-center gap-3 overflow-visible`}>
                                        <button onClick={() => toggleConcluido(t.id)} className={t.concluido ? 'text-emerald-500' : 'text-slate-300 hover:text-slate-500'}>{t.concluido ? <CheckSquare size={18} /> : <Square size={18} />}</button>
                                        {isSidebarOpen && (
                                            <div className="min-w-0 flex-1 group">
                                                <div className={`text-sm font-medium truncate mb-1 ${t.concluido ? 'line-through text-slate-400' : 'text-slate-700'}`}>{t.titulo}</div>
                                                <div className="flex items-center justify-between mt-1 relative">
                                                    <div className="flex items-center gap-2 min-w-0 flex-1">

                                                        <div
                                                            className="flex flex-col min-w-0 flex-1 cursor-pointer hover:opacity-70 transition-opacity mr-2"
                                                            title="Clique para gerenciar responsáveis"
                                                            onClick={(e) => {
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
                                                                    <PlusCircle size={12} />
                                                                    <span className="text-[10px]">Atribuir</span>
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
                                                                onChange={(e) => onToggleStatus(t.id, e.target.value)}
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
                                                    <button onClick={() => onDeleteTask(t.id)} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-opacity p-1"><Trash2 size={14} /></button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex-1 relative">
                                        <div
                                            onClick={() => onEditTask(t)}
                                            className={`absolute top-4 h-8 cursor-pointer flex items-center px-2 text-[11px] text-white font-medium whitespace-nowrap overflow-hidden transition-all rounded-md shadow-sm hover:shadow-md hover:-translate-y-0.5 ${barColorClass} ${t.concluido ? 'opacity-50 grayscale hover:shadow-sm hover:translate-y-0' : ''} ${isPushed ? 'ring-2 ring-orange-300 ring-offset-1' : ''}`}
                                            style={{ left: geo.x, width: geo.w }}
                                        >
                                            {t.constraintDate && <Pin size={10} className="mr-1 fill-white/20" />}
                                            <span className="truncate flex-1">{t.titulo}</span>
                                            {isPushed && <ArrowRight size={10} className="text-white/90 ml-1" />}
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
