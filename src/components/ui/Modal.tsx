import React from 'react';
import { X } from 'lucide-react';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, footer }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200 relative flex flex-col max-h-[90vh] border border-slate-100">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white">
                    <h2 className="font-bold text-lg text-slate-800">{title}</h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-50 transition-colors">
                        <X size={20} />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {children}
                </div>
                {footer && (
                    <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between sticky bottom-0 z-10 rounded-b-xl">
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
};
