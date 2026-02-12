import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import type { Notification } from '../../types';

interface NotificationToastProps {
    notification: Notification | null;
    onClose: () => void;
}

export const NotificationToast: React.FC<NotificationToastProps> = ({ notification, onClose }) => {
    useEffect(() => {
        if (notification) {
            const timer = setTimeout(onClose, 5000);
            return () => clearTimeout(timer);
        }
    }, [notification, onClose]);

    if (!notification) return null;

    return (
        <div className={`fixed bottom-6 right-6 z-[100] px-4 py-3 rounded-lg border border-slate-200 shadow-lg bg-white flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4`}>
            <div className={`w-2 h-2 rounded-full ${notification.type === 'error' ? 'bg-red-500' : 'bg-emerald-500'}`}></div>
            <span className="text-sm font-medium">{notification.message}</span>
            <button onClick={onClose} className="ml-auto opacity-50 hover:opacity-100"><X size={16} /></button>
        </div>
    );
};
