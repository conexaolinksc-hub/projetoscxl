import type { Tarefa } from "../types";
import { DEFAULT_WORKING_DAYS } from "../config/constants";
import { parseDate, formatDate, isWorkDay, getNextWorkDay, calendarAdd } from "./dateUtils";

export const detectCycle = (tasks: Map<string, Tarefa>): boolean => {
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

export const topologicalSort = (tasks: Map<string, Tarefa>): string[] => {
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

export const runSchedulingEngine = (allTasks: Tarefa[]): Tarefa[] => {
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
