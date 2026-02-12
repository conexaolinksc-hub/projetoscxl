import { useState, useEffect } from 'react';
import { onAuthStateChanged, signInAnonymously, signInWithCustomToken, type User } from 'firebase/auth';
import { auth } from '../config/firebase';

export const useAuth = () => {
    const [user, setUser] = useState<User | null>(null);

    useEffect(() => {
        const initAuth = async () => {
            // @ts-ignore
            if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                try {
                    // @ts-ignore
                    await signInWithCustomToken(auth, __initial_auth_token);
                } catch (e) {
                    await signInAnonymously(auth);
                }
            } else {
                await signInAnonymously(auth);
            }
        };
        initAuth();
        const unsubscribe = onAuthStateChanged(auth, setUser);
        return () => unsubscribe();
    }, []);

    return user;
};
