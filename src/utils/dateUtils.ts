import { DAY_WIDTH } from '../config/constants';

export const normalizeDate = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const parseDate = (str: string) => {
    if (!str) return normalizeDate(new Date());
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
};

export const formatDate = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

export const isWorkDay = (date: Date, workDays: number[]) => workDays.includes(date.getDay());

export const getNextWorkDay = (date: Date, workDays: number[]): Date => {
    if (workDays.length === 0) return date;
    let d = new Date(date);
    let safety = 0;
    while (!isWorkDay(d, workDays) && safety < 30) {
        d.setDate(d.getDate() + 1);
        safety++;
    }
    return d;
};

export const calendarAdd = (startDate: Date, duration: number, workDays: number[]): Date => {
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

export const calculateDuration = (startDate: Date, endDate: Date, workDays: number[]): number => {
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

export const getDaysDiff = (dateA: Date, dateB: Date) => {
    const utcA = Date.UTC(dateA.getFullYear(), dateA.getMonth(), dateA.getDate());
    const utcB = Date.UTC(dateB.getFullYear(), dateB.getMonth(), dateB.getDate());
    return Math.floor((utcB - utcA) / (1000 * 60 * 60 * 24));
};

export const getBarGeo = (s: string, f: string, ganttStartDate: Date) => {
    // This requires access to ganttStartDate or similar context to calculate position relative to start
    // Moving calculations that depend on state to components or pass necessary args
    const startIdx = getDaysDiff(ganttStartDate, parseDate(s));
    const dur = getDaysDiff(parseDate(s), parseDate(f)) + 1;
    return { x: startIdx * DAY_WIDTH, w: dur * DAY_WIDTH };
};
