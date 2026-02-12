import { useState, useEffect } from 'react';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, appId } from '../config/firebase';
import type { User } from 'firebase/auth';
import type { Tarefa, StatusConfig } from '../types';
import { DEFAULT_STATUSES } from '../config/constants';

export const useData = (user: User | null) => {
    const [tarefas, setTarefas] = useState<Tarefa[]>([]);
    const [statusList, setStatusList] = useState<StatusConfig[]>([]);

    useEffect(() => {
        if (!user) return;

        const tasksQuery = collection(db, 'artifacts', appId, 'users', user.uid, 'tasks');
        const unsubTasks = onSnapshot(tasksQuery, (snapshot) => setTarefas(snapshot.docs.map(d => d.data() as Tarefa)), (error) => console.error(error));

        const statusDocRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'statuses');
        const unsubStatus = onSnapshot(statusDocRef, (docSnap) => {
            if (docSnap.exists()) setStatusList(docSnap.data()?.list || DEFAULT_STATUSES);
            else { setDoc(statusDocRef, { list: DEFAULT_STATUSES }); setStatusList(DEFAULT_STATUSES); }
        });

        return () => { unsubTasks(); unsubStatus(); };
    }, [user]);

    return { tarefas, statusList, setStatusList };
};
